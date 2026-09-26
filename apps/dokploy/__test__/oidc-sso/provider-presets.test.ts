import { describe, expect, it } from "vitest";
import { PROVIDER_PRESETS } from "@/components/dashboard/settings/oidc-sso/provider-presets";

describe("provider presets (spec 004 FR-003)", () => {
	it("covers the seven verified providers plus a generic one", () => {
		expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
			"keycloak",
			"okta",
			"authentik",
			"zitadel",
			"auth0",
			"fusionauth",
			"authelia",
			"generic",
		]);
	});

	it.each([
		["auth0", "https://dokploy/groups", ""],
		["fusionauth", "roles", "email"],
	])("%s prefills its groups claim and scopes", (id, claim, scopes) => {
		expect(PROVIDER_PRESETS.find((preset) => preset.id === id)).toMatchObject({
			groupsClaim: claim,
			extraScopes: scopes,
		});
	});
});
