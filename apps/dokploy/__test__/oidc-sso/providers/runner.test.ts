import { describe, expect, it, vi } from "vitest";
import { buildResult } from "./results";
import { type RunnerDeps, runProviders } from "./runner";
import {
	type ProviderDriver,
	type ProviderId,
	SCENARIO_IDS,
	type VerificationResult,
} from "./types";

const selfHosted = (id: ProviderId): ProviderDriver => ({
	id,
	kind: "self-hosted",
	version: "1.0",
	requiredEnv: [],
	readyUrl: `http://127.0.0.1/${id}`,
	moduleConfig: () => ({}) as never,
	users: {} as never,
	moveUser: async () => {},
	login: async () => {},
});

const saas = (id: ProviderId, requiredEnv: string[]): ProviderDriver => ({
	...selfHosted(id),
	kind: "saas",
	version: "saas",
	requiredEnv,
	readyUrl: undefined,
});

const passedResult = (id: ProviderId, ranAt: Date): VerificationResult =>
	buildResult({
		provider: id,
		providerVersion: "1.0",
		moduleCommit: "abc",
		environment: "local",
		now: ranAt,
		scenarios: Object.fromEntries(
			SCENARIO_IDS.map((scenario) => [scenario, "passed"]),
		) as VerificationResult["scenarios"],
	});

const setup = (
	drivers: Partial<Record<ProviderId, ProviderDriver>> = {},
	overrides: Partial<RunnerDeps> = {},
) => {
	let clock = Date.parse("2026-09-26T10:00:00Z");
	const lines: string[] = [];
	const results = new Map<ProviderId, VerificationResult>();
	const deps: RunnerDeps = {
		env: {},
		log: (line) => lines.push(line),
		now: () => clock,
		loadDriver: async (id) => drivers[id] ?? selfHosted(id),
		dockerAvailable: vi.fn(async () => true),
		compose: vi.fn(async () => {}),
		waitReady: vi.fn(async () => {}),
		seed: vi.fn(async () => {}),
		battery: vi.fn(async (id: ProviderId) => {
			clock += 30_000;
			results.set(id, passedResult(id, new Date(clock)));
			return 0;
		}),
		readResult: (id) => results.get(id) ?? null,
		writeSkipped: vi.fn((id: ProviderId) => `results/${id}.json`),
		writeFailed: vi.fn((id: ProviderId) => `results/${id}.json`),
		moduleCommit: () => "abc",
		...overrides,
	};
	return { deps, lines, results };
};

describe("provider verification runner (spec 004, SC-005)", () => {
	it("FR-009: brings the environment up, seeds, runs and always tears down", async () => {
		const { deps, lines } = setup();
		await expect(runProviders("keycloak", deps)).resolves.toBe(0);
		expect(deps.compose).toHaveBeenNthCalledWith(1, "keycloak", ["up", "-d"]);
		expect(deps.waitReady).toHaveBeenCalledWith(
			"http://127.0.0.1/keycloak",
			300_000,
		);
		expect(deps.seed).toHaveBeenCalledWith("keycloak");
		expect(deps.battery).toHaveBeenCalledWith("keycloak", {
			OIDC_E2E_PROVIDER: "keycloak",
			OIDC_E2E_COMMIT: "abc",
		});
		expect(deps.compose).toHaveBeenLastCalledWith("keycloak", ["down", "-v"]);
		expect(lines).toEqual([
			expect.stringMatching(/^keycloak: passed \(30 s\)/),
		]);
	});

	it("FR-009: down -v runs even when the battery throws", async () => {
		const { deps, lines } = setup(
			{},
			{
				battery: vi.fn(async () => {
					throw new Error("vitest crashed");
				}),
			},
		);
		await expect(runProviders("keycloak", deps)).resolves.toBe(1);
		expect(deps.compose).toHaveBeenLastCalledWith("keycloak", ["down", "-v"]);
		expect(lines.at(-1)).toMatch(/^keycloak: failed \(vitest crashed\)/);
	});

	it("SC-005: a SaaS provider without credentials is skipped with exit 0", async () => {
		const { deps, lines } = setup({
			okta: saas("okta", ["OKTA_E2E_ORG_URL", "OKTA_E2E_API_TOKEN"]),
		});
		deps.env = { OKTA_E2E_ORG_URL: "https://dev.okta.test" };
		await expect(runProviders("okta", deps)).resolves.toBe(0);
		expect(deps.writeSkipped).toHaveBeenCalledWith("okta", [
			"OKTA_E2E_API_TOKEN",
		]);
		expect(deps.battery).not.toHaveBeenCalled();
		expect(deps.compose).not.toHaveBeenCalled();
		expect(lines).toEqual([
			"okta: skipped (faltan: OKTA_E2E_API_TOKEN) → results/okta.json",
		]);
	});

	it("FR-008: a SaaS provider with credentials seeds its tenant and runs, without Docker", async () => {
		const { deps } = setup({ okta: saas("okta", ["OKTA_E2E_API_TOKEN"]) });
		deps.env = { OKTA_E2E_API_TOKEN: "token" };
		await expect(runProviders("okta", deps)).resolves.toBe(0);
		expect(deps.seed).toHaveBeenCalledWith("okta");
		expect(deps.compose).not.toHaveBeenCalled();
		expect(deps.dockerAvailable).not.toHaveBeenCalled();
	});

	it("one failed provider makes the run exit 1, the rest still run", async () => {
		const { deps, results } = setup(
			{
				okta: saas("okta", ["OKTA_E2E_API_TOKEN"]),
				auth0: saas("auth0", ["AUTH0_E2E_DOMAIN"]),
			},
			{
				battery: vi.fn(async (id: ProviderId) => {
					const result = passedResult(id, new Date("2026-09-26T10:00:01Z"));
					if (id === "authentik") {
						result.status = "failed";
						result.scenarios["admin-role"] = "failed";
					}
					results.set(id, result);
					return id === "authentik" ? 1 : 0;
				}),
			},
		);
		await expect(runProviders("all", deps)).resolves.toBe(1);
		expect(deps.battery).toHaveBeenCalledTimes(5);
	});

	it("a battery that ends without a fresh result is recorded as failed", async () => {
		const { deps, results } = setup({}, { battery: vi.fn(async () => 1) });
		results.set(
			"keycloak",
			passedResult("keycloak", new Date("2026-09-01T00:00:00Z")),
		);
		await expect(runProviders("keycloak", deps)).resolves.toBe(1);
		expect(deps.writeFailed).toHaveBeenCalledWith(
			"keycloak",
			"the battery exited with 1 without results",
		);
	});

	it("a missing Docker is a runner error, exit 2", async () => {
		const { deps, lines } = setup(
			{},
			{ dockerAvailable: vi.fn(async () => false) },
		);
		await expect(runProviders("keycloak", deps)).resolves.toBe(2);
		expect(deps.compose).not.toHaveBeenCalled();
		expect(lines).toEqual([
			"error: Docker is not available (docker compose is required)",
		]);
	});

	it("an unknown provider prints the usage and exits 2", async () => {
		const { deps, lines } = setup();
		await expect(runProviders("gitlab", deps)).resolves.toBe(2);
		expect(lines[0]).toMatch(/^usage: e2e:oidc <keycloak\|okta\|/);
	});
});
