import type { UserManagementAction } from "../types";

/** Every tRPC procedure that manages other users (research R1). */
export const TRPC_USER_MANAGEMENT_PATHS: ReadonlyMap<
	string,
	UserManagementAction
> = new Map([
	["user.remove", "remove_user"],
	["user.assignPermissions", "change_permissions"],
	["user.createUserWithCredentials", "create_user"],
	["user.sendInvitation", "resend_invitation"],
	["organization.inviteMember", "invite"],
	["organization.removeInvitation", "cancel_invitation"],
	["organization.updateMemberRole", "change_role"],
]);

/** better-auth organization routes that bypass tRPC (research R1). */
export const AUTH_USER_MANAGEMENT_PATHS: ReadonlyMap<
	string,
	UserManagementAction
> = new Map([
	["/organization/remove-member", "remove_member"],
	["/organization/update-member-role", "change_role"],
	["/organization/invite-member", "invite"],
	["/organization/cancel-invitation", "cancel_invitation"],
	["/organization/create-role", "manage_roles"],
	["/organization/update-role", "manage_roles"],
	["/organization/delete-role", "manage_roles"],
]);
