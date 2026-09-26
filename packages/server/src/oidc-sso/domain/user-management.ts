import type { UserManagementDenyReason } from "../types";
import { isInGroup } from "./claims";

/** How long a user-management grant lasts after an SSO login (spec 002, FR-015). */
export const USER_MANAGEMENT_GRANT_TTL_MS = 8 * 60 * 60 * 1000;

export interface LoginState {
	groups: string[];
	lastSsoLoginAt: Date;
}

export interface UserManagementInput {
	ssoActive: boolean;
	userManagementGroup: string | null;
	isInstanceOwner: boolean;
	loginState: LoginState | null;
	now: Date;
}

export type UserManagementDecision =
	| { allow: true }
	| { allow: false; reason: UserManagementDenyReason };

/**
 * Pure policy (research R4). The group is an allow list: anything not
 * explicitly granted is denied. It only ever narrows upstream's rules, which
 * still run afterwards (FR-011).
 */
export const decideUserManagement = ({
	ssoActive,
	userManagementGroup,
	isInstanceOwner,
	loginState,
	now,
}: UserManagementInput): UserManagementDecision => {
	if (!ssoActive || !userManagementGroup) return { allow: true };
	if (isInstanceOwner) return { allow: true };
	if (!loginState) return { allow: false, reason: "no_sso_login" };
	if (
		now.getTime() - loginState.lastSsoLoginAt.getTime() >=
		USER_MANAGEMENT_GRANT_TTL_MS
	) {
		return { allow: false, reason: "grant_expired" };
	}
	if (!isInGroup(loginState.groups, userManagementGroup)) {
		return { allow: false, reason: "not_in_group" };
	}
	return { allow: true };
};
