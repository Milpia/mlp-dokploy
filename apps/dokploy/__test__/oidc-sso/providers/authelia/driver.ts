import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Authelia refuses "localhost" as a cookie domain; localtest.me resolves to 127.0.0.1.
const BASE = "https://auth.localtest.me:9091";
const DIR_VARIABLE = "OIDC_E2E_AUTHELIA_DIR";

const openssl = (dir: string, args: string[]) =>
	execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });

const users = testUsers();

export const driver: ProviderDriver = {
	id: "authelia",
	kind: "self-hosted",
	version: "4.39.28",
	requiredEnv: [],
	readyUrl: `${BASE}/.well-known/openid-configuration`,
	/** A CA, a server certificate and an OIDC key per run, never committed. */
	async prepare() {
		const dir = mkdtempSync(path.join(tmpdir(), "oidc-e2e-authelia-"));
		openssl(dir, ["genrsa", "-out", "ca.key", "2048"]);
		openssl(dir, [
			"req",
			"-x509",
			"-new",
			"-key",
			"ca.key",
			"-days",
			"1",
			"-subj",
			"/CN=dokploy e2e CA",
			"-out",
			"ca.crt",
		]);
		openssl(dir, ["genrsa", "-out", "server.key", "2048"]);
		openssl(dir, [
			"req",
			"-new",
			"-key",
			"server.key",
			"-subj",
			"/CN=auth.localtest.me",
			"-out",
			"server.csr",
		]);
		writeFileSync(
			path.join(dir, "san.ext"),
			"subjectAltName=DNS:auth.localtest.me\n",
		);
		openssl(dir, [
			"x509",
			"-req",
			"-in",
			"server.csr",
			"-CA",
			"ca.crt",
			"-CAkey",
			"ca.key",
			"-CAcreateserial",
			"-days",
			"1",
			"-extfile",
			"san.ext",
			"-out",
			"server.crt",
		]);
		openssl(dir, ["genrsa", "-out", "oidc.key", "2048"]);
		copyFileSync(
			path.join(HERE, "users_database.yml"),
			path.join(dir, "users_database.yml"),
		);
		return {
			env: { [DIR_VARIABLE]: dir },
			caFile: path.join(dir, "ca.crt"),
			cleanup: async () => rmSync(dir, { recursive: true, force: true }),
		};
	},
	moduleConfig: () => ({
		issuerUrl: BASE,
		clientId: "dokploy",
		clientSecret: "dokploy-e2e-secret",
		groupsClaim: "groups",
		extraScopes: "groups",
		allowInsecureHttp: false,
		...groupSettings,
	}),
	users,
	/** Authelia watches its users file and reloads it. */
	async moveUser(role: TestUserRole, toGroup: string) {
		const dir = globalThis.process.env[DIR_VARIABLE];
		if (!dir) throw new Error(`${DIR_VARIABLE} is not set`);
		const file = path.join(dir, "users_database.yml");
		const lines = readFileSync(file, "utf8").split("\n");
		const start = lines.findIndex(
			(line) => line === `  ${users[role].username}:`,
		);
		const groupsLine = lines.findIndex(
			(line, index) => index > start && line.startsWith("    groups:"),
		);
		lines[groupsLine] = `    groups: [${toGroup}]`;
		writeFileSync(file, lines.join("\n"));
		await new Promise((resolve) => setTimeout(resolve, 3_000));
	},
	async login(page, user) {
		await page.fill("#username-textfield", user.username);
		await page.fill("#password-textfield", user.password);
		await page.click("#sign-in-button");
	},
};
