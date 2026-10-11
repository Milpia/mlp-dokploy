import { describe, expect, it } from "vitest";
import { withoutEnterpriseSsoEntry } from "@/components/dashboard/settings/oidc-sso/enterprise-sso-entry";

const settings = [
	{ title: "License", url: "/dashboard/settings/license" },
	{ title: "SSO", url: "/dashboard/settings/sso" },
	{ title: "OIDC SSO", url: "/dashboard/settings/oidc-sso" },
];
const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe("withoutEnterpriseSsoEntry (spec 001, FR-026)", () => {
	it("hides upstream's SSO entry and keeps OIDC SSO when the variable is on and there is no license", () => {
		expect(
			titles(
				withoutEnterpriseSsoEntry(settings, {
					hide: true,
					haveValidLicense: false,
				}),
			),
		).toEqual(["License", "OIDC SSO"]);
	});

	it.each([
		{ hide: false, haveValidLicense: false },
		{ hide: undefined, haveValidLicense: undefined },
	])("leaves the menu as upstream's without the variable (%o)", (opts) => {
		expect(withoutEnterpriseSsoEntry(settings, opts)).toBe(settings);
	});

	it("keeps the entry with a valid enterprise license even when the variable is on", () => {
		expect(
			withoutEnterpriseSsoEntry(settings, {
				hide: true,
				haveValidLicense: true,
			}),
		).toBe(settings);
	});
});
