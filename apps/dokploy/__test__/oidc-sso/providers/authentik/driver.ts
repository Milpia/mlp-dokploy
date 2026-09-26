import { GROUPS, groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

const BASE = "http://localhost:9000";
const API_TOKEN = "dokploy-e2e-authentik-api-token";

const api = async (path: string, init: RequestInit = {}) => {
	const response = await fetch(`${BASE}/api/v3${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${API_TOKEN}`,
			"content-type": "application/json",
			...init.headers,
		},
	});
	if (!response.ok) {
		throw new Error(
			`Authentik ${init.method ?? "GET"} ${path}: ${response.status}`,
		);
	}
	return response.json();
};

const users = testUsers();

export const driver: ProviderDriver = {
	id: "authentik",
	kind: "self-hosted",
	version: "2026.8.3",
	requiredEnv: [],
	readyUrl: `${BASE}/application/o/dokploy/.well-known/openid-configuration`,
	moduleConfig: () => ({
		issuerUrl: `${BASE}/application/o/dokploy/`,
		clientId: "dokploy",
		clientSecret: "dokploy-e2e-secret",
		groupsClaim: "groups",
		extraScopes: "",
		allowInsecureHttp: true,
		...groupSettings,
	}),
	users,
	async moveUser(role: TestUserRole, toGroup: string) {
		if (!Object.values(GROUPS).includes(toGroup as never)) {
			throw new Error(`Authentik: unknown group ${toGroup}`);
		}
		const { results: found } = (await api(
			`/core/users/?username=${users[role].username}`,
		)) as { results: { pk: number }[] };
		const { results: groups } = (await api(
			`/core/groups/?name=${encodeURIComponent(toGroup)}`,
		)) as { results: { pk: string }[] };
		await api(`/core/users/${found[0]?.pk}/`, {
			method: "PATCH",
			body: JSON.stringify({ groups: [groups[0]?.pk] }),
		});
	},
	// Two steps (identification, then password) in web components; Playwright's
	// CSS locators pierce the shadow DOM.
	async login(page, user) {
		await page.locator('input[name="uidField"]').fill(user.username);
		await page.locator('button[type="submit"]').click();
		// The password step re-renders the form: wait for it before typing, or
		// the value lands in a field that is about to be replaced.
		await page.getByText("Not you?").waitFor();
		const password = page.locator('input[name="password"]:visible');
		await password.click();
		await password.pressSequentially(user.password);
		await page.locator('button[type="submit"]:visible').click();
	},
};
