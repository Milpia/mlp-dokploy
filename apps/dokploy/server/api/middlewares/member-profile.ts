import { getOidcSsoServices } from "@dokploy/server/oidc-sso";
import {
	checkMemberProfileExpiry,
	defaultMemberProfileExpiryDeps,
	MEMBER_PROFILE_EXPIRED_MESSAGE,
	type MemberProfileExpiryDeps,
} from "@dokploy/server/oidc-sso/member-profile/expiry";
import { TRPCError } from "@trpc/server";

interface GuardOptions<TResult> {
	ctx: { user?: { id: string; role?: string | null } | null };
	next: () => Promise<TResult>;
}

/**
 * Chained in protectedProcedure after the user-management guard (spec 005,
 * research R6). It only acts on members with a group profile; everyone else
 * goes straight to next().
 */
export const createMemberProfileGuard =
	(
		resolveDeps: () => MemberProfileExpiryDeps = () =>
			defaultMemberProfileExpiryDeps(getOidcSsoServices()),
	) =>
	async <TResult>({ ctx, next }: GuardOptions<TResult>): Promise<TResult> => {
		if (ctx.user?.role !== "member") return next();
		const result = await checkMemberProfileExpiry(
			{ id: ctx.user.id, role: ctx.user.role },
			resolveDeps(),
		);
		if (!result.ok) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: MEMBER_PROFILE_EXPIRED_MESSAGE,
			});
		}
		return next();
	};

export const memberProfileGuard = createMemberProfileGuard();
