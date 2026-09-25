import {
	extractIdentity,
	isInGroup,
	normalizeGroup,
} from "@dokploy/server/oidc-sso/domain/claims";
import { describe, expect, it } from "vitest";

describe("extractIdentity", () => {
	it("maps standard OIDC claims", () => {
		const identity = extractIdentity({
			sub: "abc-123",
			email: "Dev@Example.com ",
			email_verified: true,
			given_name: "Ada",
			family_name: "Lovelace",
			groups: ["/dokploy-users", "/dokploy-admins"],
		});
		expect(identity).toEqual({
			sub: "abc-123",
			email: "dev@example.com",
			emailVerified: true,
			givenName: "Ada",
			familyName: "Lovelace",
			groups: ["/dokploy-users", "/dokploy-admins"],
		});
	});

	it("FR-006: only a literal true counts as a verified email", () => {
		for (const value of ["true", 1, undefined, null, false]) {
			expect(
				extractIdentity({ sub: "s", email: "a@b.c", email_verified: value })
					.emailVerified,
			).toBe(false);
		}
	});

	it("tolerates missing or malformed optional claims", () => {
		const identity = extractIdentity({
			sub: "s",
			email: 42,
			given_name: ["x"],
			groups: "not-a-list",
		});
		expect(identity.email).toBeUndefined();
		expect(identity.givenName).toBeUndefined();
		expect(identity.groups).toEqual([]);
	});

	it("drops non-string group entries", () => {
		expect(
			extractIdentity({ sub: "s", groups: ["/a", 3, null, "b"] }).groups,
		).toEqual(["/a", "b"]);
	});

	it("rejects a missing subject", () => {
		expect(() => extractIdentity({ email: "a@b.c" })).toThrow();
	});
});

describe("group matching", () => {
	it("normalises leading and trailing slashes", () => {
		expect(normalizeGroup("/dokploy-users/")).toBe("dokploy-users");
		expect(normalizeGroup("teams/ops")).toBe("teams/ops");
	});

	it("FR-007: matches a plain group name against full paths and names", () => {
		expect(isInGroup(["/dokploy-users"], "dokploy-users")).toBe(true);
		expect(isInGroup(["dokploy-users"], "dokploy-users")).toBe(true);
		expect(isInGroup(["/teams/dokploy-users"], "dokploy-users")).toBe(true);
	});

	it("FR-007: a configured path requires the full path", () => {
		expect(isInGroup(["/teams/dokploy-users"], "/teams/dokploy-users")).toBe(
			true,
		);
		expect(isInGroup(["/other/dokploy-users"], "teams/dokploy-users")).toBe(
			false,
		);
	});

	it("is case-sensitive like Keycloak and never matches prefixes", () => {
		expect(isInGroup(["/Dokploy-Users"], "dokploy-users")).toBe(false);
		expect(isInGroup(["/dokploy-users-old"], "dokploy-users")).toBe(false);
	});

	it("never matches an empty configured group", () => {
		expect(isInGroup(["/", ""], "")).toBe(false);
		expect(isInGroup(["/"], "/")).toBe(false);
	});
});
