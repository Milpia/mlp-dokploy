import { describe, expect, it } from "vitest";
import { renderMatrix } from "./matrix";
import { buildResult } from "./results";
import {
	PROVIDER_IDS,
	SCENARIO_IDS,
	type ScenarioId,
	type ScenarioOutcome,
} from "./types";

const passed = Object.fromEntries(
	SCENARIO_IDS.map((id) => [id, "passed"]),
) as Record<ScenarioId, ScenarioOutcome>;

const keycloak = buildResult({
	provider: "keycloak",
	providerVersion: "26.7.4",
	moduleCommit: "abcdef1234567",
	environment: "local",
	now: new Date("2026-09-26T10:00:00Z"),
	scenarios: passed,
});

const authelia = buildResult({
	provider: "authelia",
	providerVersion: "4.39.28",
	moduleCommit: "abcdef1234567",
	environment: "ci",
	now: new Date("2026-09-27T10:00:00Z"),
	scenarios: {
		...passed,
		"sign-out": "not-applicable",
		"user-management-group": "pending",
	},
});

const okta = buildResult({
	provider: "okta",
	providerVersion: "saas",
	moduleCommit: "abcdef1234567",
	environment: "local",
	skippedMissing: ["OKTA_E2E_ORG_URL"],
});

const limitations = `# Limitaciones conocidas

## Authelia

- Sin RP-initiated logout (authelia#5057).

## Okta

- No verificado: sin tenant de pruebas.
`;

const rows = (markdown: string) =>
	markdown.split("\n").filter((line) => /^\| [A-Z]/.test(line));

describe("compatibility matrix (spec 004, FR-010, FR-014)", () => {
	const markdown = renderMatrix([keycloak, authelia, okta], limitations);

	it("FR-010: one row per provider, in the data-model order", () => {
		const names = rows(markdown)
			.slice(1)
			.map((line) => line.split("|")[1]?.trim());
		expect(names).toEqual([
			"Keycloak",
			"Okta",
			"Auth0",
			"Authentik",
			"Zitadel",
			"FusionAuth",
			"Authelia",
		]);
		expect(names).toHaveLength(PROVIDER_IDS.length);
	});

	it("FR-010: version, date and environment columns", () => {
		expect(markdown).toContain(
			"| Keycloak | 26.7.4 | 2026-09-26 | local | abcdef1 | pasa |",
		);
		expect(markdown).toContain("| Authelia | 4.39.28 | 2026-09-27 | ci |");
	});

	it("FR-014: a provider without results is «no verificado»", () => {
		expect(rows(markdown).find((line) => line.startsWith("| Auth0"))).toMatch(
			/no verificado/,
		);
	});

	it("FR-008: a skipped provider says why", () => {
		expect(rows(markdown).find((line) => line.startsWith("| Okta"))).toMatch(
			/no verificado \(faltan: OKTA_E2E_ORG_URL\)/,
		);
	});

	it("data-model: not-applicable sign-out and pending scenarios", () => {
		const row = rows(markdown).find((line) => line.startsWith("| Authelia"));
		expect(row).toContain("pasa (sin fin de sesión en el proveedor)");
		expect(row).toContain("pendiente");
	});

	it("FR-014: limitations are embedded per provider", () => {
		expect(markdown).toContain("### Authelia");
		expect(markdown).toContain("Sin RP-initiated logout (authelia#5057).");
	});

	it("FR-014: marks itself as generated", () => {
		expect(markdown).toMatch(/pnpm --filter=dokploy run e2e:oidc:matrix/);
	});
});
