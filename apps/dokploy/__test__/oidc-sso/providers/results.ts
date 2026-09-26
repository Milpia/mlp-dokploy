import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ProviderId,
	SCENARIO_IDS,
	type ScenarioId,
	type ScenarioOutcome,
	type VerificationResult,
} from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const RESULTS_DIR = path.resolve(
	HERE,
	"../../../../../specs/004-oidc-provider-compatibility/results",
);

/** contracts/runner-and-env.md: never written to files, logs or results (FR-008). */
export const SAAS_SECRET_VARIABLES = [
	"OKTA_E2E_ORG_URL",
	"OKTA_E2E_API_TOKEN",
	"AUTH0_E2E_DOMAIN",
	"AUTH0_E2E_MGMT_CLIENT_ID",
	"AUTH0_E2E_MGMT_CLIENT_SECRET",
	"OIDC_E2E_SAAS_PASSWORD",
] as const;

// Shorter values would redact ordinary words and hide the actual failure.
const MIN_REDACTED_LENGTH = 4;

export const redact = (
	message: string,
	env: Record<string, string | undefined>,
): string =>
	SAAS_SECRET_VARIABLES.map((name) => env[name])
		.filter(
			(value): value is string => (value?.length ?? 0) >= MIN_REDACTED_LENGTH,
		)
		.sort((a, b) => b.length - a.length)
		.reduce((text, value) => text.split(value).join("[redacted]"), message);

export interface ResultInput {
	provider: ProviderId;
	providerVersion: string;
	moduleCommit: string;
	environment: "local" | "ci";
	now?: Date;
	scenarios?: Record<ScenarioId, ScenarioOutcome>;
	failures?: { scenario: ScenarioId; message: string }[];
	/** Set when a SaaS provider is skipped for missing credentials. */
	skippedMissing?: string[];
	env?: Record<string, string | undefined>;
}

const allPending = () =>
	Object.fromEntries(SCENARIO_IDS.map((id) => [id, "pending"])) as Record<
		ScenarioId,
		ScenarioOutcome
	>;

export const buildResult = (input: ResultInput): VerificationResult => {
	const env = input.env ?? process.env;
	const common = {
		schema: "oidc-compat/v1" as const,
		provider: input.provider,
		providerVersion: input.providerVersion,
		moduleCommit: input.moduleCommit,
		ranAt: (input.now ?? new Date()).toISOString(),
		environment: input.environment,
	};
	if (input.skippedMissing) {
		return {
			...common,
			status: "skipped",
			skippedReason: `faltan: ${input.skippedMissing.join(", ")}`,
			scenarios: allPending(),
		};
	}

	const scenarios = { ...allPending(), ...input.scenarios };
	for (const [scenario, outcome] of Object.entries(scenarios)) {
		if (outcome === "not-applicable" && scenario !== "sign-out") {
			throw new Error(
				`${scenario}: not-applicable is only allowed on sign-out (data-model.md)`,
			);
		}
	}
	const failed = Object.values(scenarios).includes("failed");
	const failures = (input.failures ?? []).map((failure) => ({
		scenario: failure.scenario,
		message: redact(failure.message, env),
	}));
	return {
		...common,
		status: failed ? "failed" : "passed",
		scenarios,
		...(failures.length > 0 ? { failures } : {}),
	};
};

export const writeResult = (
	result: VerificationResult,
	dir: string = RESULTS_DIR,
): string => {
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${result.provider}.json`);
	writeFileSync(file, `${JSON.stringify(result, null, "\t")}\n`);
	return file;
};
