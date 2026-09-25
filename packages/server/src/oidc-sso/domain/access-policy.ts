import type { DenyReason, SsoRole } from "../types";
import { isInGroup, type SsoIdentity } from "./claims";

export interface ExistingUser {
	id: string;
	banned: boolean;
	isOwner: boolean;
}

export interface AccessInput {
	identity: SsoIdentity;
	existingUser: ExistingUser | null;
	ownerExists: boolean;
	accessGroup: string | null;
	adminGroup: string | null;
}

export type AccessDecision =
	| { allow: true; action: "login" | "create"; role: SsoRole | "unchanged" }
	| { allow: false; reason: DenyReason };

const deny = (reason: DenyReason): AccessDecision => ({ allow: false, reason });

/**
 * Pure access rules (research R7). Every branch that is not explicitly
 * allowed ends in a denial.
 */
export const decideAccess = ({
	identity,
	existingUser,
	ownerExists,
	accessGroup,
	adminGroup,
}: AccessInput): AccessDecision => {
	if (!ownerExists) return deny("no_owner");
	if (!identity.email) return deny("email_missing");
	if (!identity.emailVerified) return deny("email_unverified");
	if (existingUser?.banned) return deny("user_banned");

	if (existingUser?.isOwner) {
		return { allow: true, action: "login", role: "unchanged" };
	}

	if (accessGroup && !isInGroup(identity.groups, accessGroup)) {
		return deny("not_in_access_group");
	}
	if (!existingUser && !accessGroup) {
		return deny("provisioning_disabled");
	}

	const action = existingUser ? "login" : "create";
	if (!adminGroup) {
		return { allow: true, action, role: existingUser ? "unchanged" : "member" };
	}
	return {
		allow: true,
		action,
		role: isInGroup(identity.groups, adminGroup) ? "admin" : "member",
	};
};
