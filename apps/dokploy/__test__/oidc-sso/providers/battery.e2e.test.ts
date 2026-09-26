/**
 * The common verification battery (spec 004, FR-004), one provider per run.
 * The runner sets OIDC_E2E_PROVIDER after starting the provider:
 *
 *   pnpm --filter=dokploy run e2e:oidc keycloak
 *
 * Without it the battery is skipped, so `pnpm test` never runs it (NFR-QA-002).
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { buildResult, writeResult } from "./results";
import { GROUPS } from "./shared";
import {
	type ModuleConfig,
	type ProviderDriver,
	type ProviderId,
	SCENARIO_IDS,
	type ScenarioId,
	type ScenarioOutcome,
} from "./types";

// vitest.config.ts replaces `process.env` with a fixed object at build time;
// globalThis.process.env is the real environment.
const runtimeEnv = globalThis.process.env;
const providerId = runtimeEnv.OIDC_E2E_PROVIDER as ProviderId | undefined;

const SCENARIO_TIMEOUT_MS = 120_000;

describe.skipIf(!providerId)(`OIDC provider battery: ${providerId}`, () => {
	let driver: ProviderDriver;
	let config: ModuleConfig;
	let harness: Harness;
	let issuer = "";
	let endSessionEndpoint: string | undefined;
	const outcomes: Partial<Record<ScenarioId, ScenarioOutcome>> = {};
	const failures: { scenario: ScenarioId; message: string }[] = [];
	let setupError: string | null = null;

	const scenario = (
		id: ScenarioId,
		run: () => Promise<ScenarioOutcome | undefined>,
	) =>
		it(
			id,
			async () => {
				try {
					outcomes[id] = (await run()) ?? "passed";
				} catch (error) {
					outcomes[id] = "failed";
					failures.push({
						scenario: id,
						message: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
			},
			SCENARIO_TIMEOUT_MS,
		);

	beforeAll(async () => {
		const module = (await import(`./${providerId}/driver.ts`)) as {
			driver: ProviderDriver;
		};
		driver = module.driver;
		try {
			await setUp();
		} catch (error) {
			setupError = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}, SCENARIO_TIMEOUT_MS);

	const setUp = async () => {
		config = await driver.moduleConfig();
		const discovery = await fetch(
			`${config.issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`,
		);
		if (!discovery.ok) {
			throw new Error(
				`${providerId}: discovery answered ${discovery.status} at ${config.issuerUrl}`,
			);
		}
		const document = (await discovery.json()) as {
			issuer: string;
			end_session_endpoint?: string;
		};
		issuer = document.issuer;
		endSessionEndpoint = document.end_session_endpoint;
		harness = await createHarness(config, {
			ignoreHTTPSErrors: config.issuerUrl.startsWith("https://"),
		});
	};

	afterAll(async () => {
		await harness?.close();
		if (!driver) return;
		// A scenario that never ran is a failure, never a silent pass.
		for (const id of SCENARIO_IDS) {
			if (outcomes[id]) continue;
			outcomes[id] = "failed";
			failures.push({ scenario: id, message: setupError ?? "not run" });
		}
		const moduleCommit =
			runtimeEnv.OIDC_E2E_COMMIT ??
			execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
		const file = writeResult(
			buildResult({
				provider: driver.id,
				providerVersion:
					driver.kind === "saas"
						? `saas ${new Date().toISOString().slice(0, 10)}`
						: driver.version,
				moduleCommit,
				environment: runtimeEnv.CI ? "ci" : "local",
				scenarios: outcomes as Record<ScenarioId, ScenarioOutcome>,
				failures,
				env: runtimeEnv,
			}),
			runtimeEnv.OIDC_E2E_RESULTS_DIR,
		);
		console.info(`[oidc-e2e] ${driver.id}: results written to ${file}`);
	});

	scenario("login-provisioning", async () => {
		const result = await harness.signIn(driver.login, driver.users.member);
		expect(result.landing).toBe("/dashboard/projects");
		expect(result.role).toBe("member");
		return "passed";
	});

	scenario("admin-role", async () => {
		const result = await harness.signIn(driver.login, driver.users.admin);
		expect(result.landing).toBe("/dashboard/projects");
		expect(result.role).toBe("admin");
		return "passed";
	});

	scenario("access-denied", async () => {
		const result = await harness.signIn(driver.login, driver.users.outsider);
		expect(result.landing).toMatch(/error=sso_access_denied/);
		expect(result.userId).toBeUndefined();
		return "passed";
	});

	scenario("role-change", async () => {
		await driver.moveUser("member", GROUPS.admin);
		try {
			const promoted = await harness.signIn(driver.login, driver.users.member);
			expect(promoted.role).toBe("admin");
		} finally {
			await driver.moveUser("member", GROUPS.access);
		}
		const demoted = await harness.signIn(driver.login, driver.users.member);
		expect(demoted.role).toBe("member");
		return "passed";
	});

	scenario("connection-test-ok", async () => {
		await expect(
			harness.testConnection(config.clientSecret),
		).resolves.toMatchObject({ ok: true });
		return "passed";
	});

	scenario("connection-test-bad", async () => {
		// SC-004: a wrong secret must never be reported as a working connection.
		const result = await harness.testConnection(`${config.clientSecret}-wrong`);
		expect(result.ok).toBe(false);
		return "passed";
	});

	scenario("user-management-group", async () => {
		const manager = await harness.signIn(driver.login, driver.users.manager);
		expect(manager.role).toBe("admin");
		await expect(
			harness.userManagementStatus(manager.userId as string),
		).resolves.toMatchObject({ canManageUsers: true });

		const admin = await harness.signIn(driver.login, driver.users.admin);
		await expect(
			harness.userManagementStatus(admin.userId as string),
		).resolves.toMatchObject({ canManageUsers: false, reason: "not_in_group" });
		return "passed";
	});

	scenario("sign-out", async () => {
		await harness.setMode("sso-only", issuer);
		await harness.signIn(driver.login, driver.users.member);
		const result = await harness.signOut();
		expect(result.sessionEnded).toBe(true);
		if (!endSessionEndpoint) {
			// No RP-initiated logout at the provider: the signed-out screen (spec 001 FR-025).
			expect(result.target).toBe("/?signed_out=1");
			return "not-applicable";
		}
		// The provider's end-session endpoint answered; returning to Dokploy is optional.
		expect(result.target.startsWith(endSessionEndpoint)).toBe(true);
		expect(result.providerStatus).toBeLessThan(400);
		return "passed";
	});
});
