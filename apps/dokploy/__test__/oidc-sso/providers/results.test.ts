import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildResult,
	RESULTS_DIR,
	redact,
	SAAS_SECRET_VARIABLES,
	writeResult,
} from "./results";
import { SCENARIO_IDS, type ScenarioId, type ScenarioOutcome } from "./types";

const allPassed = Object.fromEntries(
	SCENARIO_IDS.map((id) => [id, "passed"]),
) as Record<ScenarioId, ScenarioOutcome>;

const base = {
	provider: "keycloak" as const,
	providerVersion: "26.7.4",
	moduleCommit: "abc123",
	environment: "local" as const,
	now: new Date("2026-09-26T10:00:00Z"),
};

describe("verification results (spec 004, FR-014)", () => {
	it("FR-014: passed only when no scenario failed", () => {
		expect(buildResult({ ...base, scenarios: allPassed }).status).toBe(
			"passed",
		);
		const result = buildResult({
			...base,
			scenarios: { ...allPassed, "access-denied": "failed" },
			failures: [{ scenario: "access-denied", message: "logged in" }],
		});
		expect(result).toMatchObject({
			schema: "oidc-compat/v1",
			status: "failed",
			ranAt: "2026-09-26T10:00:00.000Z",
		});
	});

	it("FR-014: pending and not-applicable do not fail the provider", () => {
		const result = buildResult({
			...base,
			scenarios: {
				...allPassed,
				"sign-out": "not-applicable",
				"user-management-group": "pending",
			},
		});
		expect(result.status).toBe("passed");
	});

	it.each(SCENARIO_IDS.filter((id) => id !== "sign-out"))(
		"FR-014: not-applicable is only allowed on sign-out, not on %s",
		(scenario) => {
			expect(() =>
				buildResult({
					...base,
					scenarios: { ...allPassed, [scenario]: "not-applicable" },
				}),
			).toThrow(/not-applicable/);
		},
	);

	it("FR-008: a skipped result names the missing variables", () => {
		const result = buildResult({
			...base,
			provider: "okta",
			providerVersion: "saas",
			skippedMissing: ["OKTA_E2E_ORG_URL", "OKTA_E2E_API_TOKEN"],
		});
		expect(result).toMatchObject({
			status: "skipped",
			skippedReason: "faltan: OKTA_E2E_ORG_URL, OKTA_E2E_API_TOKEN",
		});
		expect(Object.values(result.scenarios)).toEqual(
			SCENARIO_IDS.map(() => "pending"),
		);
	});

	it("FR-008: every SaaS credential value is redacted from failure messages", () => {
		const env = Object.fromEntries(
			SAAS_SECRET_VARIABLES.map((name, i) => [name, `secret-value-${i}`]),
		);
		const message = SAAS_SECRET_VARIABLES.map(
			(_, i) => `token secret-value-${i} leaked`,
		).join("; ");
		const clean = redact(message, env);
		for (const value of Object.values(env)) {
			expect(clean).not.toContain(value);
		}
		expect(clean).toContain("[redacted]");

		const result = buildResult({
			...base,
			scenarios: { ...allPassed, "admin-role": "failed" },
			failures: [{ scenario: "admin-role", message }],
			env,
		});
		expect(JSON.stringify(result)).not.toContain("secret-value-");
	});

	it("FR-008: short or empty values are not used for redaction", () => {
		expect(
			redact("a b c", { OKTA_E2E_API_TOKEN: "", AUTH0_E2E_DOMAIN: "b" }),
		).toBe("a b c");
	});

	it("FR-014: writes results/<id>.json under the spec folder", () => {
		expect(RESULTS_DIR).toMatch(
			/specs[\\/]004-oidc-provider-compatibility[\\/]results$/,
		);
		const dir = mkdtempSync(path.join(tmpdir(), "oidc-results-"));
		const file = writeResult(
			buildResult({ ...base, scenarios: allPassed }),
			dir,
		);
		expect(file).toBe(path.join(dir, "keycloak.json"));
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
			provider: "keycloak",
			status: "passed",
		});
	});
});
