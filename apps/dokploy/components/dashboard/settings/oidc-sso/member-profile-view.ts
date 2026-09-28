export interface MemberProfileSummary {
	groups: string[];
	expired: boolean;
}

export interface MemberProfileStatus {
	managed: boolean;
	expired: boolean;
	readOnly?: { serviceIds: string[] };
}

/** Label next to the role in the users list (spec 005, FR-011). */
export const profileBadgeLabel = (
	summary: MemberProfileSummary | undefined,
): string | null => {
	if (!summary) return null;
	const label = `SSO: ${summary.groups.join(", ")}`;
	return summary.expired ? `${label} · expired` : label;
};

/** Warning in the permissions dialog that manual edits will not last (FR-011). */
export const overwriteNotice = (
	summary: MemberProfileSummary | undefined,
): string | null =>
	summary
		? `These permissions come from the SSO group${summary.groups.length > 1 ? "s" : ""} ${summary.groups.join(", ")}. Changes made here are replaced at the user's next SSO login.`
		: null;

/** Whether to ask the member to sign in with SSO again (FR-017). */
export const showExpiredNotice = (
	status: MemberProfileStatus | undefined,
): boolean => !!status?.managed && status.expired;

/**
 * Whether a service page shows the read-only badge and disables its change
 * actions (spec 006, FR-010). The server enforces it anyway (FR-005); an
 * expired profile has no scope left to show.
 */
export const isReadOnlyService = (
	status: MemberProfileStatus | undefined,
	serviceId: string,
): boolean =>
	!!status?.managed &&
	!status.expired &&
	(status.readOnly?.serviceIds.includes(serviceId) ?? false);
