import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GROUPS, groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

export const BASE = "http://localhost:8081";
export const DIR_VARIABLE = "OIDC_E2E_ZITADEL_DIR";

export const runDir = () => {
	const dir = globalThis.process.env[DIR_VARIABLE];
	if (!dir) throw new Error(`${DIR_VARIABLE} is not set`);
	return dir;
};

export const api = async (pathName: string, init: RequestInit = {}) => {
	const token = readFileSync(path.join(runDir(), "admin.pat"), "utf8").trim();
	const response = await fetch(`${BASE}${pathName}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			...init.headers,
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Zitadel ${init.method ?? "GET"} ${pathName}: ${response.status} ${text.slice(0, 200)}`,
		);
	}
	return text ? JSON.parse(text) : null;
};

export interface SeededApp {
	projectId: string;
	clientId: string;
	clientSecret: string;
	userIds: Record<string, string>;
}

export const seeded = (): SeededApp =>
	JSON.parse(readFileSync(path.join(runDir(), "app.json"), "utf8"));

const users = testUsers();

export const driver: ProviderDriver = {
	id: "zitadel",
	kind: "self-hosted",
	version: "v4.19.0",
	requiredEnv: [],
	readyUrl: `${BASE}/.well-known/openid-configuration`,
	async prepare() {
		const dir = mkdtempSync(path.join(tmpdir(), "oidc-e2e-zitadel-"));
		// The runner process needs the directory too, for seed.ts.
		globalThis.process.env[DIR_VARIABLE] = dir;
		return {
			env: { [DIR_VARIABLE]: dir },
			cleanup: async () => rmSync(dir, { recursive: true, force: true }),
		};
	},
	// Project roles play the part of groups (research R2).
	moduleConfig: () => {
		const app = seeded();
		return {
			issuerUrl: BASE,
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			groupsClaim: "urn:zitadel:iam:org:project:roles",
			extraScopes: "urn:zitadel:iam:org:project:roles",
			allowInsecureHttp: true,
			...groupSettings,
		};
	},
	users,
	async moveUser(role: TestUserRole, toGroup: string) {
		if (!Object.values(GROUPS).includes(toGroup as never)) {
			throw new Error(`Zitadel: unknown role ${toGroup}`);
		}
		const app = seeded();
		const userId = app.userIds[users[role].username];
		const { result = [] } = (await api("/management/v1/users/grants/_search", {
			method: "POST",
			body: JSON.stringify({ queries: [{ userIdQuery: { userId } }] }),
		})) as { result?: { id: string }[] };
		for (const grant of result) {
			await api(`/management/v1/users/${userId}/grants/${grant.id}`, {
				method: "DELETE",
			});
		}
		await api(`/management/v1/users/${userId}/grants`, {
			method: "POST",
			body: JSON.stringify({ projectId: app.projectId, roleKeys: [toGroup] }),
		});
	},
	async login(page, user) {
		await page.fill("#loginName", user.username);
		await page.click("#submit-button");
		await page.fill("#password", user.password);
		await page.click("#submit-button");
		// First sign-in may offer to set up a second factor: skip it.
		const skip = page.locator("#cancel-button, button:has-text('Skip')");
		if (
			await skip
				.first()
				.isVisible({ timeout: 3_000 })
				.catch(() => false)
		) {
			await skip.first().click();
		}
	},
};
