import type { UserManagementDenyReason } from "@dokploy/server/oidc-sso/types";

export type UserManagementStatus = {
	canManageUsers: boolean;
	reason: UserManagementDenyReason | null;
	expiresAt: string | null;
};

// Upstream's permission flags stay the source of truth; this only narrows them.
// An unknown status hides the actions, since the server would deny them anyway.
export const userManagementVisibility = <Flags extends Record<string, boolean>>(
	upstream: Flags,
	status: UserManagementStatus | undefined,
): Flags & { showExpiredNotice: boolean } => {
	if (status?.canManageUsers) {
		return { ...upstream, showExpiredNotice: false };
	}
	const hidden = Object.fromEntries(
		Object.keys(upstream).map((key) => [key, false]),
	) as Flags;
	return {
		...hidden,
		showExpiredNotice: status?.reason === "grant_expired",
	};
};
