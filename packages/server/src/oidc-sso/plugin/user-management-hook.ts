import {
	APIError,
	createAuthMiddleware,
	getIp,
	getSessionFromCtx,
} from "better-auth/api";
import {
	checkUserManagement,
	type TargetRef,
	type UserManagementGuardDeps,
} from "../user-management/guard";
import { AUTH_USER_MANAGEMENT_PATHS } from "../user-management/paths";

const targetFrom = (body: unknown): TargetRef | undefined => {
	const value = body as {
		memberIdOrEmail?: unknown;
		memberId?: unknown;
	} | null;
	if (typeof value?.memberIdOrEmail === "string") {
		return { memberIdOrEmail: value.memberIdOrEmail };
	}
	if (typeof value?.memberId === "string") return { memberId: value.memberId };
	return undefined;
};

/**
 * better-auth's organization routes do not go through tRPC, so a lead could
 * otherwise call them directly (spec 002, research R1 and R3).
 */
export const createUserManagementHook = (
	resolveDeps: () => UserManagementGuardDeps,
) => ({
	matcher: (ctx: { path?: string }) =>
		!!ctx.path && AUTH_USER_MANAGEMENT_PATHS.has(ctx.path),
	handler: createAuthMiddleware(async (ctx) => {
		const action = AUTH_USER_MANAGEMENT_PATHS.get(ctx.path);
		if (!action) return;
		const session = await getSessionFromCtx(ctx);
		if (!session) return;

		const ip = ctx.request
			? getIp(ctx.request, ctx.context.options)
			: undefined;
		const target = targetFrom(ctx.body);
		const result = await checkUserManagement(resolveDeps(), {
			userId: session.user.id,
			action,
			...(target ? { target } : {}),
			...(ip ? { ip } : {}),
		});
		if (!result.allow) {
			throw new APIError("FORBIDDEN", { message: result.message });
		}
	}),
});
