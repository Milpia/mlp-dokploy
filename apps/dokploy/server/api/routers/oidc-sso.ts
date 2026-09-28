import { IS_CLOUD } from "@dokploy/server/constants";
import {
	BUTTON_LABEL_MAX_LENGTH,
	getOidcSsoServices,
	SSO_MODES,
} from "@dokploy/server/oidc-sso";
import {
	ConfigUpdateError,
	getConfigView,
	getPublicConfig,
	testSsoConnection,
	updateSsoConfig,
} from "@dokploy/server/oidc-sso/admin/config-admin";
import {
	GROUP_PROFILES_MAX_BYTES,
	parseGroupProfiles,
} from "@dokploy/server/oidc-sso/domain/group-profiles";
import {
	checkGroupProfiles,
	drizzleScopeCatalog,
} from "@dokploy/server/oidc-sso/member-profile/scope";
import {
	findProfileWithLogin,
	listProfilesWithLogin,
	toStatus,
	toSummaries,
} from "@dokploy/server/oidc-sso/member-profile/status";
import {
	defaultUserManagementGuardDeps,
	getUserManagementStatus,
} from "@dokploy/server/oidc-sso/user-management/guard";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	if (IS_CLOUD) {
		throw new TRPCError({ code: "NOT_FOUND" });
	}
	// ctx.user.role is the role in the active organization, and any admin can
	// create an organization they own; the instance-wide IdP config belongs to
	// the instance owner only.
	const instanceOwnerId = await getOidcSsoServices().instanceOwnerId();
	if (!instanceOwnerId || ctx.user.id !== instanceOwnerId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the instance owner can manage single sign-on.",
		});
	}
	return next();
});

const optionalText = z.string().max(512).nullable().optional();

const connectionInput = z.object({
	issuerUrl: optionalText,
	clientId: optionalText,
	clientSecret: z.string().max(1024).optional(),
	allowInsecureHttp: z.boolean().optional(),
});

const updateInput = connectionInput.extend({
	mode: z.enum(SSO_MODES).optional(),
	accessGroup: optionalText,
	adminGroup: optionalText,
	userManagementGroup: optionalText,
	groupProfiles: z.string().max(GROUP_PROFILES_MAX_BYTES).nullable().optional(),
	groupsClaim: z.string().max(256).optional(),
	extraScopes: z.string().max(1024).optional(),
	buttonLabel: z.string().trim().min(1).max(BUTTON_LABEL_MAX_LENGTH).optional(),
});

const requestIp = (req: { headers: Record<string, unknown> } | undefined) => {
	const forwarded = req?.headers["x-forwarded-for"];
	const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
	return typeof value === "string" ? value.split(",")[0]?.trim() : undefined;
};

const PRECONDITION_CODES = new Set([
	"incomplete",
	"unverified",
	"issuer_change_in_sso_only",
]);

export const oidcSsoRouter = createTRPCRouter({
	publicConfig: publicProcedure.query(() =>
		IS_CLOUD
			? { mode: "disabled" as const, buttonLabel: "" }
			: getPublicConfig(getOidcSsoServices()),
	),

	// Any signed-in user asks about themselves, so the users page can hide
	// what the server would refuse anyway (spec 002, FR-007).
	userManagementStatus: protectedProcedure.query(({ ctx }) =>
		IS_CLOUD
			? { canManageUsers: true, reason: null, expiresAt: null }
			: getUserManagementStatus(defaultUserManagementGuardDeps(), ctx.user.id),
	),

	// Any signed-in user asks about their own group profile (spec 005, FR-017).
	memberProfileStatus: protectedProcedure.query(async ({ ctx }) =>
		IS_CLOUD
			? toStatus(null, new Date())
			: toStatus(await findProfileWithLogin(ctx.user.id), new Date()),
	),

	// Admins see which members' permissions come from their groups (FR-011).
	memberProfiles: protectedProcedure.query(async ({ ctx }) => {
		if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
			throw new TRPCError({ code: "FORBIDDEN" });
		}
		if (IS_CLOUD) return {};
		return toSummaries(
			await listProfilesWithLogin(ctx.session.activeOrganizationId),
			new Date(),
		);
	}),

	groupProfilesCheck: ownerProcedure.query(async ({ ctx }) => {
		const config = await getOidcSsoServices().config.getEffective();
		const parsed = parseGroupProfiles(config.groupProfiles);
		return {
			groups: parsed.ok
				? await checkGroupProfiles(
						parsed.profiles,
						ctx.session.activeOrganizationId,
						drizzleScopeCatalog,
					)
				: [],
		};
	}),

	get: ownerProcedure.query(() => getConfigView(getOidcSsoServices())),

	update: ownerProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
		try {
			const ip = requestIp(ctx.req);
			return await updateSsoConfig(getOidcSsoServices(), input, {
				userId: ctx.user.id,
				email: ctx.user.email,
				...(ip ? { ip } : {}),
			});
		} catch (error) {
			if (error instanceof ConfigUpdateError) {
				throw new TRPCError({
					code: PRECONDITION_CODES.has(error.code)
						? "PRECONDITION_FAILED"
						: "BAD_REQUEST",
					message: error.message,
					cause: error,
				});
			}
			throw error;
		}
	}),

	testConnection: ownerProcedure
		.input(connectionInput)
		.mutation(({ input }) => testSsoConnection(getOidcSsoServices(), input)),

	listEvents: ownerProcedure
		.input(
			z.object({
				page: z.number().int().min(1).optional(),
				pageSize: z.number().int().min(1).max(100).optional(),
			}),
		)
		.query(({ input }) =>
			getOidcSsoServices().events.listPage(input.page, input.pageSize),
		),
});
