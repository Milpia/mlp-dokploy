import { getOidcSsoServices } from "@dokploy/server/oidc-sso";
import {
	checkReadOnlyCall,
	defaultReadOnlyGuardDeps,
	type ReadOnlyGuardDeps,
	type ReadOnlyVerdict,
	readOnlyEvent,
} from "@dokploy/server/oidc-sso/read-only/guard";
import { redact } from "@dokploy/server/oidc-sso/read-only/redact";
import { READ_ONLY_DENIED_MESSAGE } from "@dokploy/server/oidc-sso/types";
import { TRPCError } from "@trpc/server";

interface GuardOptions<TResult> {
	ctx: { user?: { id: string; role?: string | null } | null };
	path: string;
	type: string;
	getRawInput: () => Promise<unknown>;
	next: () => Promise<TResult>;
}

const denied = () =>
	new TRPCError({ code: "FORBIDDEN", message: READ_ONLY_DENIED_MESSAGE });

// A subscription returns a stream, not data; its events are logs, which
// FR-004 keeps readable.
const masked = <TResult>(
	result: TResult,
	scope: Extract<ReadOnlyVerdict, { kind: "allow" }>["scope"],
): TResult => {
	const outcome = result as { ok?: unknown; data?: unknown };
	if (outcome?.ok !== true || !("data" in outcome)) return result;
	return { ...outcome, data: redact(outcome.data, scope) } as TResult;
};

/**
 * Chained in protectedProcedure after the expiry guard (spec 006, research
 * R4), so the UI and API keys both pass through it. Errors of the check deny;
 * errors of the procedure itself propagate untouched.
 */
export const createReadOnlyGuard =
	(
		resolveDeps: () => ReadOnlyGuardDeps = () =>
			defaultReadOnlyGuardDeps(getOidcSsoServices()),
	) =>
	async <TResult>({
		ctx,
		path,
		type,
		getRawInput,
		next,
	}: GuardOptions<TResult>): Promise<TResult> => {
		if (ctx.user?.role !== "member") return next();
		const call = { user: ctx.user, path, type, getRawInput };
		const deps = resolveDeps();
		let verdict: ReadOnlyVerdict;
		try {
			verdict = await checkReadOnlyCall(call, deps);
		} catch (error) {
			console.error("OIDC SSO: read-only check failed", error);
			await deps.record(readOnlyEvent(call, "error")).catch(() => {});
			throw denied();
		}
		if (verdict.kind === "deny") {
			await deps
				.record(readOnlyEvent(call, "denied", verdict.resourceId))
				.catch(() => {});
			throw denied();
		}
		if (verdict.kind === "pass" || type === "subscription") return next();
		return masked(await next(), verdict.scope);
	};

export const readOnlyGuard = createReadOnlyGuard();
