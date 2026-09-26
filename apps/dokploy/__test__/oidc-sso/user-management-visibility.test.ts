import { describe, expect, it } from "vitest";
import { userManagementVisibility } from "@/components/dashboard/settings/oidc-sso/user-management-visibility";

const upstream = {
	canChangeRole: true,
	canEditPermissions: true,
	canRemove: true,
	canDelete: false,
};

const allFalse = {
	canChangeRole: false,
	canEditPermissions: false,
	canRemove: false,
	canDelete: false,
};

describe("userManagementVisibility (spec 002, FR-007, US1 scenario 3)", () => {
	it("keeps upstream's flags untouched when the user may manage users", () => {
		expect(
			userManagementVisibility(upstream, {
				canManageUsers: true,
				reason: null,
				expiresAt: null,
			}),
		).toEqual({ ...upstream, showExpiredNotice: false });
	});

	it.each(["not_in_group", "no_sso_login", "check_failed"] as const)(
		"hides every action for %s, without a notice",
		(reason) => {
			expect(
				userManagementVisibility(upstream, {
					canManageUsers: false,
					reason,
					expiresAt: null,
				}),
			).toEqual({ ...allFalse, showExpiredNotice: false });
		},
	);

	it("FR-015: hides every action and shows the notice when the grant expired", () => {
		expect(
			userManagementVisibility(upstream, {
				canManageUsers: false,
				reason: "grant_expired",
				expiresAt: null,
			}),
		).toEqual({ ...allFalse, showExpiredNotice: true });
	});

	it("fails closed while the status is still loading", () => {
		expect(userManagementVisibility(upstream, undefined)).toEqual({
			...allFalse,
			showExpiredNotice: false,
		});
	});

	it("works for the page-level flags too", () => {
		expect(
			userManagementVisibility(
				{ canInvite: true, canManageRoles: true },
				{ canManageUsers: false, reason: "not_in_group", expiresAt: null },
			),
		).toEqual({
			canInvite: false,
			canManageRoles: false,
			showExpiredNotice: false,
		});
	});
});
