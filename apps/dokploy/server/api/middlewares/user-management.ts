import {
	checkUserManagement,
	defaultUserManagementGuardDeps,
	type TargetRef,
	type UserManagementGuardDeps,
} from "@dokploy/server/oidc-sso/user-management/guard";
import { TRPC_USER_MANAGEMENT_PATHS } from "@dokploy/server/oidc-sso/user-management/paths";
import { TRPCError } from "@trpc/server";

interface GuardOptions<TResult> {
	ctx: {
		user?: { id: string } | null;
		req?: { headers: Record<string, unknown> };
	};
	path: string;
	getRawInput: () => Promise<unknown>;
	next: () => Promise<TResult>;
}

const requestIp = (req: GuardOptions<unknown>["ctx"]["req"]) => {
	const forwarded = req?.headers["x-forwarded-for"];
	const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
	return typeof value === "string" ? value.split(",")[0]?.trim() : undefined;
};

const targetFrom = async (
	getRawInput: () => Promise<unknown>,
): Promise<TargetRef | undefined> => {
	try {
		const input = (await getRawInput()) as {
			userId?: unknown;
			memberId?: unknown;
		} | null;
		if (typeof input?.userId === "string") return { userId: input.userId };
		if (typeof input?.memberId === "string") return { memberId: input.memberId };
	} catch {
		// Without a readable input the denial is still recorded, just without a target.
	}
	return undefined;
};

/**
 * Chained once in protectedProcedure (spec 002, research R2). Every other
 * path returns straight to next() without reading config or the database.
 */
export const createUserManagementGuard =
	(resolveDeps: () => UserManagementGuardDeps = defaultUserManagementGuardDeps) =>
	async <TResult>({
		ctx,
		path,
		getRawInput,
		next,
	}: GuardOptions<TResult>): Promise<TResult> => {
		const action = TRPC_USER_MANAGEMENT_PATHS.get(path);
		if (!action || !ctx.user) return next();

		const ip = requestIp(ctx.req);
		const result = await checkUserManagement(resolveDeps(), {
			userId: ctx.user.id,
			action,
			target: await targetFrom(getRawInput),
			...(ip ? { ip } : {}),
		});
		if (!result.allow) {
			throw new TRPCError({ code: "FORBIDDEN", message: result.message });
		}
		return next();
	};

export const userManagementGuard = createUserManagementGuard();
