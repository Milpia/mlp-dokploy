import { db } from "@dokploy/server/db";
import { member, user } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { decideUserManagement } from "../domain/user-management";
import { newCorrelationId } from "../events/auth-events";
import {
	drizzleLoginStateStore,
	type LoginStateStore,
} from "../identity/login-state";
import { getOidcSsoServices, type OidcSsoServices } from "../services";
import type { UserManagementAction, UserManagementDenyReason } from "../types";

/** They never name the configured group (contracts/user-management-guard.md). */
export const USER_MANAGEMENT_MESSAGES: Record<
	UserManagementDenyReason,
	string
> = {
	not_in_group: "You are not allowed to manage users.",
	no_sso_login: "Sign in with SSO to manage users.",
	grant_expired:
		"Your permission to manage users expired. Sign in with SSO again.",
	check_failed: "You are not allowed to manage users.",
};

export interface TargetRef {
	userId?: string;
	memberId?: string;
	memberIdOrEmail?: string;
}

export interface UserManagementGuardDeps {
	services: Pick<OidcSsoServices, "config" | "events" | "instanceOwnerId">;
	loginState: Pick<LoginStateStore, "find">;
	resolveTarget(ref: TargetRef): Promise<string | null>;
	now?: () => Date;
	logError?: (message: string, error: unknown) => void;
}

export interface UserManagementRequest {
	userId: string;
	action: UserManagementAction;
	target?: TargetRef;
	ip?: string;
}

type Denial = {
	allow: false;
	reason: UserManagementDenyReason;
	message: string;
};

export type UserManagementCheck = { allow: true } | Denial;

const deny = (reason: UserManagementDenyReason): Denial => ({
	allow: false,
	reason,
	message: USER_MANAGEMENT_MESSAGES[reason],
});

export const drizzleResolveTarget = async (
	ref: TargetRef,
): Promise<string | null> => {
	if (ref.userId) return ref.userId;
	const memberId = ref.memberId ?? ref.memberIdOrEmail;
	if (memberId) {
		const found = await db.query.member.findFirst({
			where: eq(member.id, memberId),
		});
		if (found) return found.userId;
	}
	if (ref.memberIdOrEmail?.includes("@")) {
		const found = await db.query.user.findFirst({
			where: eq(user.email, ref.memberIdOrEmail),
		});
		if (found) return found.id;
	}
	return null;
};

export const defaultUserManagementGuardDeps = (): UserManagementGuardDeps => ({
	services: getOidcSsoServices(),
	loginState: drizzleLoginStateStore,
	resolveTarget: drizzleResolveTarget,
});

/**
 * One decision for both the tRPC procedures and better-auth's organization
 * routes, so the answer and the recorded event never depend on the path taken.
 */
export const checkUserManagement = async (
	deps: UserManagementGuardDeps,
	request: UserManagementRequest,
): Promise<UserManagementCheck> => {
	const now = deps.now ?? (() => new Date());
	const logError =
		deps.logError ?? ((message, error) => console.error(message, error));

	let result: Denial;
	try {
		const config = await deps.services.config.getEffective();
		const group = config.userManagementGroup;
		if (!config.active || !group) return { allow: true };

		const [ownerId, loginState] = await Promise.all([
			deps.services.instanceOwnerId(),
			deps.loginState.find(request.userId),
		]);
		const decision = decideUserManagement({
			ssoActive: true,
			userManagementGroup: group,
			isInstanceOwner: ownerId === request.userId,
			loginState,
			now: now(),
		});
		if (decision.allow) return decision;
		result = deny(decision.reason);
	} catch (error) {
		logError("OIDC SSO: user-management check failed", error);
		result = deny("check_failed");
	}

	let targetUserId: string | null = null;
	if (request.target) {
		try {
			targetUserId = await deps.resolveTarget(request.target);
		} catch (error) {
			logError("OIDC SSO: could not resolve the affected user", error);
		}
	}
	try {
		await deps.services.events.record({
			type: "user_management",
			outcome: "denied",
			reason: result.reason,
			correlationId: newCorrelationId(),
			userId: request.userId,
			action: request.action,
			...(targetUserId ? { targetUserId } : {}),
			...(request.ip ? { ip: request.ip } : {}),
		});
	} catch (error) {
		logError(
			"OIDC SSO: could not record a denied user-management attempt",
			error,
		);
	}
	return result;
};
