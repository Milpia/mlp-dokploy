const TYPE_LABELS: Record<string, string> = {
	sso_login: "SSO sign-in",
	emergency_login: "Emergency sign-in",
	config_change: "Configuration change",
	mode_change: "Mode change",
	user_management: "User management",
};

const ACTION_LABELS: Record<string, string> = {
	remove_user: "Delete user",
	remove_member: "Remove member",
	invite: "Invite",
	create_user: "Create user",
	resend_invitation: "Resend invitation",
	cancel_invitation: "Cancel invitation",
	change_role: "Change role",
	change_permissions: "Change permissions",
	manage_roles: "Manage roles",
};

export interface AuthEventRow {
	type: string;
	email?: string;
	userId?: string;
	userEmail?: string;
	action?: string;
	targetUserId?: string;
	targetUserEmail?: string;
}

export interface AuthEventView {
	type: string;
	who: string;
	action: string;
	target: string;
}

export const eventPagination = (
	total: number,
	page: number,
	pageSize: number,
) => {
	const pageCount = Math.max(Math.ceil(total / pageSize), 1);
	return {
		pageCount,
		from: total === 0 ? 0 : (page - 1) * pageSize + 1,
		to: Math.min(page * pageSize, total),
		canPrevious: page > 1,
		canNext: page < pageCount,
	};
};

/**
 * The raw id is the fallback when the user was deleted after the event,
 * so the owner can still correlate it with the database (spec 002 FR-012).
 */
export const authEventView = (event: AuthEventRow): AuthEventView => ({
	type: TYPE_LABELS[event.type] ?? event.type,
	who: event.email ?? event.userEmail ?? event.userId ?? "",
	action: event.action ? (ACTION_LABELS[event.action] ?? event.action) : "",
	target: event.targetUserEmail ?? event.targetUserId ?? "",
});
