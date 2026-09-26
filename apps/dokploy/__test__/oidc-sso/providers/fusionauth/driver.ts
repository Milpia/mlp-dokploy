import { groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

export const BASE = "http://localhost:9011";
export const API_KEY = "dokploy-e2e-fusionauth-api-key-0123456789abcdef";
export const APPLICATION_ID = "d0c410e2-5e5e-4e2e-9d0c-e2e000000004";

export const api = async (path: string, init: RequestInit = {}) => {
	const response = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			authorization: API_KEY,
			"content-type": "application/json",
			...init.headers,
		},
	});
	if (!response.ok) {
		throw new Error(
			`FusionAuth ${init.method ?? "GET"} ${path}: ${response.status}`,
		);
	}
	const text = await response.text();
	return text ? JSON.parse(text) : null;
};

const users = testUsers();

export const driver: ProviderDriver = {
	id: "fusionauth",
	kind: "self-hosted",
	version: "1.69.2",
	requiredEnv: [],
	readyUrl: `${BASE}/.well-known/openid-configuration`,
	// Application roles, granted through groups, arrive in the "roles" claim.
	moduleConfig: () => ({
		issuerUrl: BASE,
		clientId: APPLICATION_ID,
		clientSecret: "dokploy-e2e-secret",
		groupsClaim: "roles",
		extraScopes: "",
		allowInsecureHttp: true,
		...groupSettings,
	}),
	users,
	async moveUser(role: TestUserRole, toGroup: string) {
		const { user } = (await api(
			`/api/user?username=${users[role].username}`,
		)) as { user: { id: string; memberships?: { groupId: string }[] } };
		for (const membership of user.memberships ?? []) {
			await api(
				`/api/group/member?groupId=${membership.groupId}&userId=${user.id}`,
				{ method: "DELETE" },
			);
		}
		const { groups } = (await api("/api/group")) as {
			groups: { id: string; name: string }[];
		};
		const target = groups.find((group) => group.name === toGroup);
		if (!target) throw new Error(`FusionAuth: unknown group ${toGroup}`);
		await api("/api/group/member", {
			method: "POST",
			body: JSON.stringify({ members: { [target.id]: [{ userId: user.id }] } }),
		});
	},
	async login(page, user) {
		await page.fill("#loginId", user.username);
		await page.fill("#password", user.password);
		await page.locator("#password").press("Enter");
	},
};
