import { describe, expect, it } from "vitest";
import {
	overwriteNotice,
	profileBadgeLabel,
	showExpiredNotice,
} from "@/components/dashboard/settings/oidc-sso/member-profile-view";

describe("member profile view (spec 005, FR-011, FR-017)", () => {
	it("labels a managed member with its groups", () => {
		expect(profileBadgeLabel({ groups: ["developers"], expired: false })).toBe(
			"SSO: developers",
		);
		expect(
			profileBadgeLabel({ groups: ["developers", "qa"], expired: true }),
		).toBe("SSO: developers, qa · expired");
		expect(profileBadgeLabel(undefined)).toBeNull();
	});

	it("warns that manual edits are replaced only for managed members", () => {
		expect(overwriteNotice({ groups: ["developers"], expired: false })).toBe(
			"These permissions come from the SSO group developers. Changes made here are replaced at the user's next SSO login.",
		);
		expect(overwriteNotice(undefined)).toBeNull();
	});

	it("asks to sign in again only when a managed profile expired", () => {
		expect(showExpiredNotice({ managed: true, expired: true })).toBe(true);
		expect(showExpiredNotice({ managed: true, expired: false })).toBe(false);
		expect(showExpiredNotice({ managed: false, expired: false })).toBe(false);
		expect(showExpiredNotice(undefined)).toBe(false);
	});
});
