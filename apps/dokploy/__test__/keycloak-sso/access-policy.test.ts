import {
	type AccessInput,
	decideAccess,
} from "@dokploy/server/keycloak-sso/domain/access-policy";
import { describe, expect, it } from "vitest";

const identity = (overrides: Partial<AccessInput["identity"]> = {}) => ({
	sub: "sub-1",
	email: "dev@example.com",
	emailVerified: true,
	groups: ["/dokploy-users"],
	...overrides,
});

const input = (overrides: Partial<AccessInput> = {}): AccessInput => ({
	identity: identity(),
	existingUser: null,
	ownerExists: true,
	accessGroup: "dokploy-users",
	adminGroup: "dokploy-admins",
	...overrides,
});

const existing = (
	overrides: Partial<NonNullable<AccessInput["existingUser"]>> = {},
) => ({ id: "u1", banned: false, isOwner: false, ...overrides });

describe("decideAccess — denials (fail closed)", () => {
	it("denies when the instance has no owner yet", () => {
		expect(decideAccess(input({ ownerExists: false }))).toEqual({
			allow: false,
			reason: "no_owner",
		});
	});

	it("FR-006: denies when Keycloak sends no email", () => {
		expect(
			decideAccess(input({ identity: identity({ email: undefined }) })),
		).toEqual({ allow: false, reason: "email_missing" });
	});

	it("FR-006: denies an unverified email, even for an already linked user", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ emailVerified: false }),
					existingUser: existing(),
				}),
			),
		).toEqual({ allow: false, reason: "email_unverified" });
	});

	it("denies a banned user", () => {
		expect(
			decideAccess(input({ existingUser: existing({ banned: true }) })),
		).toEqual({ allow: false, reason: "user_banned" });
	});

	it("FR-007: denies a new user outside the access group", () => {
		expect(
			decideAccess(input({ identity: identity({ groups: ["/others"] }) })),
		).toEqual({ allow: false, reason: "not_in_access_group" });
	});

	it("FR-007b: denies an existing non-owner outside the access group", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ groups: [] }),
					existingUser: existing(),
				}),
			),
		).toEqual({ allow: false, reason: "not_in_access_group" });
	});

	it("FR-007a: denies creating accounts when no access group is configured", () => {
		expect(decideAccess(input({ accessGroup: null }))).toEqual({
			allow: false,
			reason: "provisioning_disabled",
		});
	});
});

describe("decideAccess — owner", () => {
	it("FR-008b: lets the owner in without groups and never touches the role", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ groups: [] }),
					existingUser: existing({ isOwner: true }),
				}),
			),
		).toEqual({ allow: true, action: "login", role: "unchanged" });
	});

	it("FR-008b: the owner stays owner even inside the admin group", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ groups: ["/dokploy-admins"] }),
					existingUser: existing({ isOwner: true }),
				}),
			),
		).toEqual({ allow: true, action: "login", role: "unchanged" });
	});

	it("a banned owner is still denied", () => {
		expect(
			decideAccess(
				input({ existingUser: existing({ isOwner: true, banned: true }) }),
			),
		).toEqual({ allow: false, reason: "user_banned" });
	});
});

describe("decideAccess — roles", () => {
	it("FR-007/FR-008: creates a member from the access group", () => {
		expect(decideAccess(input())).toEqual({
			allow: true,
			action: "create",
			role: "member",
		});
	});

	it("FR-008: creates an admin from the admin group", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ groups: ["/dokploy-users", "/dokploy-admins"] }),
				}),
			),
		).toEqual({ allow: true, action: "create", role: "admin" });
	});

	it("FR-008a: recalculates an existing user's role on every login", () => {
		expect(
			decideAccess(
				input({
					identity: identity({ groups: ["/dokploy-users"] }),
					existingUser: existing(),
				}),
			),
		).toEqual({ allow: true, action: "login", role: "member" });
	});

	it("FR-008: without an admin group, existing users keep their role", () => {
		expect(
			decideAccess(input({ adminGroup: null, existingUser: existing() })),
		).toEqual({ allow: true, action: "login", role: "unchanged" });
	});

	it("FR-008: without an admin group, new users are members", () => {
		expect(decideAccess(input({ adminGroup: null }))).toEqual({
			allow: true,
			action: "create",
			role: "member",
		});
	});

	it("FR-006: without an access group, existing users can still link", () => {
		expect(
			decideAccess(input({ accessGroup: null, existingUser: existing() })),
		).toEqual({ allow: true, action: "login", role: "member" });
	});

	it("the admin group alone does not grant access", () => {
		expect(
			decideAccess(
				input({ identity: identity({ groups: ["/dokploy-admins"] }) }),
			),
		).toEqual({ allow: false, reason: "not_in_access_group" });
	});
});
