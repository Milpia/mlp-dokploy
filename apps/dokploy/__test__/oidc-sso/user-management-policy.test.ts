import {
	decideUserManagement,
	USER_MANAGEMENT_GRANT_TTL_MS,
	type UserManagementInput,
} from "@dokploy/server/oidc-sso/domain/user-management";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-09-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const input = (
	overrides: Partial<UserManagementInput> = {},
): UserManagementInput => ({
	ssoActive: true,
	userManagementGroup: "admins",
	isInstanceOwner: false,
	loginState: { groups: ["admins"], lastSsoLoginAt: ago(60_000) },
	now: NOW,
	...overrides,
});

describe("decideUserManagement (spec 002)", () => {
	it("FR-009: allows everything while SSO is inactive", () => {
		expect(
			decideUserManagement(input({ ssoActive: false, loginState: null })),
		).toEqual({ allow: true });
	});

	it("FR-009: allows everything when no user-management group is configured", () => {
		expect(
			decideUserManagement(
				input({ userManagementGroup: null, loginState: null }),
			),
		).toEqual({ allow: true });
	});

	it("FR-010: the instance owner always manages users, whatever the login state", () => {
		expect(
			decideUserManagement(input({ isInstanceOwner: true, loginState: null })),
		).toEqual({ allow: true });
		expect(
			decideUserManagement(
				input({
					isInstanceOwner: true,
					loginState: { groups: [], lastSsoLoginAt: ago(10 * 3_600_000) },
				}),
			),
		).toEqual({ allow: true });
	});

	it("FR-014: denies an admin with no SSO login on record", () => {
		expect(decideUserManagement(input({ loginState: null }))).toEqual({
			allow: false,
			reason: "no_sso_login",
		});
	});

	it("FR-015: the grant expires exactly 8 hours after the last SSO login", () => {
		expect(USER_MANAGEMENT_GRANT_TTL_MS).toBe(8 * 60 * 60 * 1000);
		expect(
			decideUserManagement(
				input({
					loginState: {
						groups: ["admins"],
						lastSsoLoginAt: ago(USER_MANAGEMENT_GRANT_TTL_MS),
					},
				}),
			),
		).toEqual({ allow: false, reason: "grant_expired" });
		expect(
			decideUserManagement(
				input({
					loginState: {
						groups: ["admins"],
						lastSsoLoginAt: ago(USER_MANAGEMENT_GRANT_TTL_MS - 60_000),
					},
				}),
			),
		).toEqual({ allow: true });
	});

	it("FR-003: denies a lead outside the user-management group", () => {
		expect(
			decideUserManagement(
				input({ loginState: { groups: ["leads"], lastSsoLoginAt: ago(1) } }),
			),
		).toEqual({ allow: false, reason: "not_in_group" });
	});

	it("FR-003: an expired grant is reported before a group mismatch", () => {
		expect(
			decideUserManagement(
				input({
					loginState: {
						groups: ["leads"],
						lastSsoLoginAt: ago(USER_MANAGEMENT_GRANT_TTL_MS + 1),
					},
				}),
			),
		).toEqual({ allow: false, reason: "grant_expired" });
	});

	it("US2 scenario 2: someone in both admins and leads can manage users", () => {
		expect(
			decideUserManagement(
				input({
					loginState: { groups: ["leads", "admins"], lastSsoLoginAt: ago(1) },
				}),
			),
		).toEqual({ allow: true });
	});

	it("FR-002: a comma-separated group list matches any entry", () => {
		expect(
			decideUserManagement(
				input({
					userManagementGroup: "owners, admins",
					loginState: { groups: ["admins"], lastSsoLoginAt: ago(1) },
				}),
			),
		).toEqual({ allow: true });
	});

	it("FR-003: an empty group list is denied (fail closed)", () => {
		expect(
			decideUserManagement(
				input({ loginState: { groups: [], lastSsoLoginAt: ago(1) } }),
			),
		).toEqual({ allow: false, reason: "not_in_group" });
	});
});
