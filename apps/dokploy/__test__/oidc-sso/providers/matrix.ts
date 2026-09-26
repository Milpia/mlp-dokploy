import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./results";
import {
	PROVIDER_IDS,
	type ProviderId,
	SCENARIO_IDS,
	type ScenarioId,
	type ScenarioOutcome,
	type VerificationResult,
} from "./types";

export const SPEC_DIR = path.dirname(RESULTS_DIR);

const PROVIDER_NAMES: Record<ProviderId, string> = {
	keycloak: "Keycloak",
	okta: "Okta",
	auth0: "Auth0",
	authentik: "Authentik",
	zitadel: "Zitadel",
	fusionauth: "FusionAuth",
	authelia: "Authelia",
};

const SCENARIO_TITLES: Record<ScenarioId, string> = {
	"login-provisioning": "Alta por grupo",
	"admin-role": "Rol admin",
	"access-denied": "Denegación",
	"role-change": "Cambio de rol",
	"sign-out": "Cierre de sesión",
	"connection-test-ok": "Conexión OK",
	"connection-test-bad": "Secreto malo",
	"user-management-group": "Gestión de usuarios (002)",
};

const cell = (scenario: ScenarioId, outcome: ScenarioOutcome) => {
	if (outcome === "passed") return "pasa";
	if (outcome === "failed") return "**falla**";
	if (outcome === "pending") return "pendiente";
	return scenario === "sign-out"
		? "pasa (sin fin de sesión en el proveedor)"
		: "no aplica";
};

/** `## <Provider>` sections of limitations.md, keyed by provider. */
const limitationSections = (markdown: string) => {
	const sections = new Map<string, string>();
	for (const part of markdown.split(/^## /m).slice(1)) {
		const [title = "", ...body] = part.split("\n");
		sections.set(title.trim().toLowerCase(), body.join("\n").trim());
	}
	return sections;
};

export const renderMatrix = (
	results: VerificationResult[],
	limitations: string,
): string => {
	const byProvider = new Map(
		results.map((result) => [result.provider, result]),
	);
	const header = [
		"Proveedor",
		"Versión",
		"Fecha",
		"Entorno",
		"Commit",
		...SCENARIO_IDS.map((id) => SCENARIO_TITLES[id]),
	];
	const lines = [
		"# Matriz de compatibilidad OIDC",
		"",
		"<!-- Generado por `pnpm --filter=dokploy run e2e:oidc:matrix` desde results/*.json y limitations.md. No editar a mano. -->",
		"",
		"Cada fila resume la última verificación del proveedor con la batería común de la spec 004 (FR-004).",
		"",
		`| ${header.join(" | ")} |`,
		`|${header.map(() => "---").join("|")}|`,
	];
	for (const id of PROVIDER_IDS) {
		const name = PROVIDER_NAMES[id];
		const result = byProvider.get(id);
		if (!result || result.status === "skipped") {
			const why = result?.skippedReason ? ` (${result.skippedReason})` : "";
			lines.push(
				`| ${name} | — | ${result ? result.ranAt.slice(0, 10) : "—"} | — | — | no verificado${why} |${SCENARIO_IDS.slice(
					1,
				)
					.map(() => " — |")
					.join("")}`,
			);
			continue;
		}
		const cells = SCENARIO_IDS.map((scenario) =>
			cell(scenario, result.scenarios[scenario]),
		);
		lines.push(
			`| ${name} | ${result.providerVersion} | ${result.ranAt.slice(0, 10)} | ${result.environment} | ${result.moduleCommit.slice(0, 7)} | ${cells.join(" | ")} |`,
		);
	}

	const sections = limitationSections(limitations);
	lines.push("", "## Limitaciones conocidas", "");
	for (const id of PROVIDER_IDS) {
		const text = sections.get(PROVIDER_NAMES[id].toLowerCase());
		if (!text) continue;
		lines.push(`### ${PROVIDER_NAMES[id]}`, "", text, "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
};

export const readResults = (dir: string = RESULTS_DIR): VerificationResult[] =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((file) => file.endsWith(".json"))
				.map(
					(file) =>
						JSON.parse(
							readFileSync(path.join(dir, file), "utf8"),
						) as VerificationResult,
				)
		: [];

export const writeMatrix = (specDir: string = SPEC_DIR) => {
	const limitationsFile = path.join(specDir, "limitations.md");
	const limitations = existsSync(limitationsFile)
		? readFileSync(limitationsFile, "utf8")
		: "";
	const file = path.join(specDir, "compatibility.md");
	writeFileSync(
		file,
		renderMatrix(readResults(path.join(specDir, "results")), limitations),
	);
	return file;
};
