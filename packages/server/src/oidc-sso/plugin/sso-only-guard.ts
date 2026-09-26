import { APIError, createAuthMiddleware, getIp } from "better-auth/api";
import { newCorrelationId } from "../events/auth-events";
import {
	EMERGENCY_ORIGIN_DENIED,
	EMERGENCY_ORIGIN_HEADER,
} from "./emergency-origin";
import type { SsoEndpointDeps } from "./endpoints";

export const SSO_REQUIRED_MESSAGE =
	"Single sign-on is required on this instance. Ask your administrator to add you to the access group in your identity provider.";

const EMERGENCY_DENIED_MESSAGE = "Single sign-on is required on this instance.";

/**
 * Every local way in. Prefixes are used on purpose so that sign-in methods
 * added upstream later are blocked by default (fail closed).
 */
const GUARDED_PREFIXES = [
	"/sign-in/",
	"/sign-up/",
	"/passkey/verify-authentication",
	"/passkey/generate-authenticate-options",
	"/request-password-reset",
	"/forget-password",
	"/reset-password",
];

export const isGuardedPath = (path: string) =>
	GUARDED_PREFIXES.some((prefix) => path.startsWith(prefix));

export type GuardDecision =
	| { action: "allow" }
	| { action: "emergency" }
	| { action: "deny"; message: string; emergencyAttempt: boolean };

/** Pure policy for local auth routes while SSO-only is active (FR-009/012). */
export const evaluateLocalAuth = ({
	path,
	email,
	ownerEmail,
	ssoOnly,
}: {
	path: string;
	email: unknown;
	ownerEmail: string | null;
	ssoOnly: boolean;
}): GuardDecision => {
	if (!ssoOnly || !isGuardedPath(path)) return { action: "allow" };

	if (path === "/sign-in/email") {
		const isOwner =
			typeof email === "string" &&
			!!ownerEmail &&
			email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
		return isOwner
			? { action: "emergency" }
			: {
					action: "deny",
					message: EMERGENCY_DENIED_MESSAGE,
					emergencyAttempt: true,
				};
	}
	return {
		action: "deny",
		message: SSO_REQUIRED_MESSAGE,
		emergencyAttempt: false,
	};
};

const isSsoOnly = async (deps: SsoEndpointDeps) => {
	const config = await deps.services.config.getEffective();
	return config.active && config.mode === "sso-only";
};

const emailFromBody = (body: unknown) =>
	typeof (body as { email?: unknown } | null)?.email === "string"
		? ((body as { email: string }).email.trim().toLowerCase() as string)
		: undefined;

export const createSsoOnlyGuard = (resolveDeps: () => SsoEndpointDeps) => ({
	before: [
		{
			matcher: (ctx: { path?: string }) =>
				!!ctx.path && isGuardedPath(ctx.path),
			handler: createAuthMiddleware(async (ctx) => {
				const deps = resolveDeps();
				if (!(await isSsoOnly(deps))) return;

				const decision = evaluateLocalAuth({
					path: ctx.path,
					email: (ctx.body as { email?: unknown } | undefined)?.email,
					ownerEmail: await deps.findOwnerEmail(),
					ssoOnly: true,
				});
				if (decision.action !== "deny") return;

				const recordedByTunnel =
					ctx.request?.headers.get(EMERGENCY_ORIGIN_HEADER) ===
					EMERGENCY_ORIGIN_DENIED;
				if (decision.emergencyAttempt && !recordedByTunnel) {
					const email = emailFromBody(ctx.body);
					const ip = ctx.request
						? getIp(ctx.request, ctx.context.options)
						: undefined;
					await deps.services.events.record({
						type: "emergency_login",
						outcome: "denied",
						reason: "not_owner",
						correlationId: newCorrelationId(),
						...(email ? { email } : {}),
						...(ip ? { ip } : {}),
					});
				}
				throw new APIError("FORBIDDEN", { message: decision.message });
			}),
		},
	],
	after: [
		{
			matcher: (ctx: { path?: string }) => ctx.path === "/sign-in/email",
			handler: createAuthMiddleware(async (ctx) => {
				const deps = resolveDeps();
				if (!(await isSsoOnly(deps))) return;
				// Non-owner attempts were rejected (and recorded) by the before hook.
				const email = emailFromBody(ctx.body);
				const ownerEmail = (await deps.findOwnerEmail())?.toLowerCase();
				if (!email || email !== ownerEmail) return;

				const failed = ctx.context.returned instanceof APIError;
				const ip = ctx.request
					? getIp(ctx.request, ctx.context.options)
					: undefined;
				// Only the plugin's onRequest can set this header (spec 003).
				const viaEmergencyOrigin =
					ctx.request?.headers.get(EMERGENCY_ORIGIN_HEADER) === "1";
				await deps.services.events.record({
					type: "emergency_login",
					outcome: failed ? "denied" : "success",
					reason: failed ? "invalid_credentials" : "password_verified",
					correlationId: newCorrelationId(),
					email,
					...(ip ? { ip } : {}),
					...(viaEmergencyOrigin ? { emergencyOrigin: true } : {}),
				});
			}),
		},
	],
});
