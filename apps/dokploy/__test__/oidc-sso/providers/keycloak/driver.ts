import { GROUPS, groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

const BASE = "http://localhost:8080";
const REALM = "dokploy-e2e";

const adminToken = async () => {
	const response = await fetch(
		`${BASE}/realms/master/protocol/openid-connect/token`,
		{
			method: "POST",
			body: new URLSearchParams({
				grant_type: "password",
				client_id: "admin-cli",
				username: "admin",
				password: "admin",
			}),
		},
	);
	if (!response.ok) throw new Error(`Keycloak admin token: ${response.status}`);
	return ((await response.json()) as { access_token: string }).access_token;
};

const adminApi = async (path: string, init: RequestInit = {}) => {
	const response = await fetch(`${BASE}/admin/realms/${REALM}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${await adminToken()}`,
			"content-type": "application/json",
			...init.headers,
		},
	});
	if (!response.ok) {
		throw new Error(
			`Keycloak ${init.method ?? "GET"} ${path}: ${response.status}`,
		);
	}
	return response.status === 204 ? null : response.json();
};

const users = testUsers();

export const driver: ProviderDriver = {
	id: "keycloak",
	kind: "self-hosted",
	version: "26.7.4",
	requiredEnv: [],
	readyUrl: `${BASE}/realms/${REALM}/.well-known/openid-configuration`,
	moduleConfig: () => ({
		issuerUrl: `${BASE}/realms/${REALM}`,
		clientId: "dokploy",
		clientSecret: "dokploy-e2e-secret",
		groupsClaim: "groups",
		extraScopes: "",
		allowInsecureHttp: true,
		...groupSettings,
	}),
	users,
	async moveUser(role: TestUserRole, toGroup: string) {
		const [user] = (await adminApi(
			`/users?username=${users[role].username}&exact=true`,
		)) as { id: string }[];
		const groups = (await adminApi("/groups")) as {
			id: string;
			name: string;
		}[];
		const current = (await adminApi(`/users/${user?.id}/groups`)) as {
			id: string;
		}[];
		for (const group of current) {
			await adminApi(`/users/${user?.id}/groups/${group.id}`, {
				method: "DELETE",
			});
		}
		const target = groups.find((group) => group.name === toGroup);
		if (!target || !Object.values(GROUPS).includes(toGroup as never)) {
			throw new Error(`Keycloak: unknown group ${toGroup}`);
		}
		await adminApi(`/users/${user?.id}/groups/${target.id}`, { method: "PUT" });
	},
	async login(page, user) {
		await page.fill("#username", user.username);
		await page.fill("#password", user.password);
		await page.click("#kc-login");
	},
};
