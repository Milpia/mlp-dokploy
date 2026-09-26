import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildResult, RESULTS_DIR, writeResult } from "./results";
import {
	PROVIDER_IDS,
	type ProviderDriver,
	type ProviderId,
	SCENARIO_IDS,
	type VerificationResult,
} from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PROVIDERS_DIR = HERE;
const APP_DIR = path.resolve(HERE, "../../..");
const READY_TIMEOUT_MS = 5 * 60_000;

export interface RunnerDeps {
	env: Record<string, string | undefined>;
	log(line: string): void;
	now(): number;
	loadDriver(id: ProviderId): Promise<ProviderDriver>;
	dockerAvailable(): Promise<boolean>;
	/** `docker compose -p oidc-e2e-<id> -f <dir>/compose.yml <args>`. */
	compose(
		id: ProviderId,
		args: string[],
		env?: Record<string, string>,
	): Promise<void>;
	waitReady(url: string, timeoutMs: number, caFile?: string): Promise<void>;
	/** Runs providers/<id>/seed.ts when it exists. */
	seed(id: ProviderId): Promise<void>;
	/** Runs battery.e2e.test.ts for the provider; resolves to Vitest's exit code. */
	battery(id: ProviderId, env: Record<string, string>): Promise<number>;
	readResult(id: ProviderId): VerificationResult | null;
	writeSkipped(id: ProviderId, missing: string[]): string;
	/** When the battery ended without writing a fresh result. */
	writeFailed(id: ProviderId, message: string): string;
	moduleCommit(): string;
}

export class RunnerError extends Error {}

const resultPath = (id: ProviderId) => path.join(RESULTS_DIR, `${id}.json`);

const runOne = async (
	deps: RunnerDeps,
	id: ProviderId,
): Promise<"passed" | "failed" | "skipped"> => {
	const started = deps.now();
	const startedAt = new Date(started).toISOString();
	const elapsed = () => `${Math.round((deps.now() - started) / 1000)} s`;
	const driver = await deps.loadDriver(id);

	if (driver.kind === "saas") {
		const missing = driver.requiredEnv.filter((name) => !deps.env[name]);
		if (missing.length > 0) {
			const file = deps.writeSkipped(id, missing);
			deps.log(`${id}: skipped (faltan: ${missing.join(", ")}) → ${file}`);
			return "skipped";
		}
	}

	const batteryEnv = {
		OIDC_E2E_PROVIDER: id,
		OIDC_E2E_COMMIT: deps.moduleCommit(),
	};
	let exitCode: number;
	if (driver.kind === "self-hosted") {
		const prepared = (await driver.prepare?.()) ?? { env: {} };
		try {
			await deps.compose(id, ["up", "-d"], prepared.env);
			try {
				if (driver.readyUrl) {
					await deps.waitReady(
						driver.readyUrl,
						READY_TIMEOUT_MS,
						prepared.caFile,
					);
				}
				await deps.seed(id);
				exitCode = await deps.battery(id, {
					...batteryEnv,
					...prepared.env,
					...(prepared.caFile ? { NODE_EXTRA_CA_CERTS: prepared.caFile } : {}),
				});
			} finally {
				await deps.compose(id, ["down", "-v"], prepared.env);
			}
		} finally {
			await prepared.cleanup?.();
		}
	} else {
		await deps.seed(id);
		exitCode = await deps.battery(id, batteryEnv);
	}

	const result = deps.readResult(id);
	const fresh = result !== null && result.ranAt >= startedAt;
	if (!fresh) {
		deps.writeFailed(id, `the battery exited with ${exitCode} without results`);
	}
	const status =
		fresh && exitCode === 0 && result.status === "passed" ? "passed" : "failed";
	deps.log(`${id}: ${status} (${elapsed()}) → ${resultPath(id)}`);
	return status;
};

/**
 * `e2e:oidc <id|all>` (contracts/runner-and-env.md). Exit codes: 0 when every
 * provider run passed or was skipped, 1 when one failed, 2 on a runner error.
 */
export const runProviders = async (
	target: string | undefined,
	deps: RunnerDeps,
): Promise<number> => {
	const ids: ProviderId[] =
		target === "all"
			? [...PROVIDER_IDS]
			: PROVIDER_IDS.includes(target as ProviderId)
				? [target as ProviderId]
				: [];
	if (ids.length === 0) {
		deps.log(`usage: e2e:oidc <${PROVIDER_IDS.join("|")}|all>`);
		return 2;
	}
	try {
		const drivers = await Promise.all(ids.map((id) => deps.loadDriver(id)));
		if (
			drivers.some((driver) => driver.kind === "self-hosted") &&
			!(await deps.dockerAvailable())
		) {
			deps.log("error: Docker is not available (docker compose is required)");
			return 2;
		}
		let failed = false;
		for (const id of ids) {
			try {
				if ((await runOne(deps, id)) === "failed") failed = true;
			} catch (error) {
				if (error instanceof RunnerError) throw error;
				failed = true;
				deps.log(
					`${id}: failed (${error instanceof Error ? error.message : String(error)})`,
				);
			}
		}
		return failed ? 1 : 0;
	} catch (error) {
		deps.log(
			`error: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 2;
	}
};

const run = (
	command: string,
	args: string[],
	options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) =>
	new Promise<number>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? APP_DIR,
			env: { ...process.env, ...options.env },
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => resolve(code ?? 1));
	});

export const defaultRunnerDeps = (): RunnerDeps => ({
	env: process.env,
	log: (line) => console.log(line),
	now: () => Date.now(),
	loadDriver: async (id) =>
		(
			(await import(path.join(PROVIDERS_DIR, id, "driver.ts"))) as {
				driver: ProviderDriver;
			}
		).driver,
	dockerAvailable: async () => {
		try {
			return (await run("docker", ["compose", "version"], {})) === 0;
		} catch {
			return false;
		}
	},
	compose: async (id, args, env = {}) => {
		const code = await run(
			"docker",
			[
				"compose",
				"-p",
				`oidc-e2e-${id}`,
				"-f",
				path.join(PROVIDERS_DIR, id, "compose.yml"),
				...args,
			],
			{ env },
		);
		if (code !== 0) {
			throw new Error(`docker compose ${args.join(" ")} exited with ${code}`);
		}
	},
	waitReady: async (url, timeoutMs, caFile) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const ok = caFile
				? await httpsOk(url, readFileSync(caFile))
				: await fetch(url)
						.then((response) => response.ok)
						.catch(() => false);
			if (ok) return;
			await new Promise((resolve) => setTimeout(resolve, 2_000));
		}
		throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
	},
	seed: async (id) => {
		const file = path.join(PROVIDERS_DIR, id, "seed.ts");
		if (!existsSync(file)) return;
		const module = (await import(file)) as { seed: () => Promise<void> };
		await module.seed();
	},
	battery: (_id, env) =>
		run(
			"pnpm",
			[
				"exec",
				"vitest",
				"run",
				"--config",
				"__test__/vitest.config.ts",
				"__test__/oidc-sso/providers/battery.e2e.test.ts",
			],
			{ env },
		),
	readResult: (id) => {
		const file = resultPath(id);
		if (!existsSync(file)) return null;
		return JSON.parse(readFileSync(file, "utf8")) as VerificationResult;
	},
	writeSkipped: (id, missing) =>
		writeResult(
			buildResult({
				provider: id,
				providerVersion: "saas",
				moduleCommit: defaultCommit(),
				environment: process.env.CI ? "ci" : "local",
				skippedMissing: missing,
			}),
		),
	writeFailed: (id, message) =>
		writeResult(
			buildResult({
				provider: id,
				providerVersion: "unknown",
				moduleCommit: defaultCommit(),
				environment: process.env.CI ? "ci" : "local",
				scenarios: Object.fromEntries(
					SCENARIO_IDS.map((scenario) => [scenario, "failed"]),
				) as VerificationResult["scenarios"],
				failures: [{ scenario: "login-provisioning", message }],
			}),
		),
	moduleCommit: () => defaultCommit(),
});

/** fetch cannot trust an extra CA per request; node:https can. */
const httpsOk = (url: string, ca: Buffer) =>
	new Promise<boolean>((resolve) => {
		const request = httpsGet(url, { ca }, (response) => {
			response.resume();
			resolve((response.statusCode ?? 500) < 400);
		});
		request.on("error", () => resolve(false));
	});

const defaultCommit = () =>
	execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
