import { getOidcSsoServices } from "@dokploy/server/oidc-sso";
import {
	defaultMemberNetworkGuardDeps,
	isMemberNetworkChange,
	MEMBER_NETWORK_DENIED_MESSAGE,
	type MemberNetworkGuardDeps,
	memberNetworkEvent,
} from "@dokploy/server/oidc-sso/member-profile/network-guard";
import { TRPCError } from "@trpc/server";

interface GuardOptions<TResult> {
	ctx: { user?: { id: string; role?: string | null } | null };
	path: string;
	type: string;
	next: () => Promise<TResult>;
}

const denied = () =>
	new TRPCError({ code: "FORBIDDEN", message: MEMBER_NETWORK_DENIED_MESSAGE });

/**
 * Chained in protectedProcedure after the read-only guard (spec 005, FR-018).
 * Upstream's network router checks the organization and nothing else, so the
 * UI and API keys both stop here. A configuration that cannot be read denies.
 */
export const createMemberNetworkGuard =
	(
		resolveDeps: () => MemberNetworkGuardDeps = () =>
			defaultMemberNetworkGuardDeps(getOidcSsoServices()),
	) =>
	async <TResult>({
		ctx,
		path,
		type,
		next,
	}: GuardOptions<TResult>): Promise<TResult> => {
		const call = { user: ctx.user, path, type };
		if (!isMemberNetworkChange(call)) return next();
		const deps = resolveDeps();
		let active: boolean;
		try {
			active = await deps.isSsoActive();
		} catch (error) {
			console.error("OIDC SSO: member network check failed", error);
			throw denied();
		}
		if (!active) return next();
		await deps.record(memberNetworkEvent(call)).catch(() => {});
		throw denied();
	};

export const memberNetworkGuard = createMemberNetworkGuard();
