import type { TestUser, TestUserRole } from "./types";

/** The group names every provider's seed uses (roles at Zitadel, FusionAuth and Auth0). */
export const GROUPS = {
	access: "dokploy-users",
	admin: "dokploy-admins",
	management: "admins-mgmt",
} as const;

/** Self-hosted test password (see README.md: fixed test values only). */
export const E2E_PASSWORD = "Passw0rd-e2e!";

export const REDIRECT_URI = "http://localhost:39000/api/auth/oidc/callback";
export const POST_LOGOUT_URI = "http://localhost:39000/";

export const testUsers = (
	emailDomain = "e2e.test",
	password = E2E_PASSWORD,
): Record<TestUserRole, TestUser> => ({
	member: { username: "member", password, email: `member@${emailDomain}` },
	admin: { username: "admin", password, email: `admin@${emailDomain}` },
	outsider: {
		username: "outsider",
		password,
		email: `outsider@${emailDomain}`,
	},
	manager: { username: "manager", password, email: `manager@${emailDomain}` },
});

/** What every provider configures in Dokploy, apart from issuer, client and claim. */
export const groupSettings = {
	accessGroup: `${GROUPS.access},${GROUPS.admin}`,
	adminGroup: GROUPS.admin,
	userManagementGroup: GROUPS.management,
};
