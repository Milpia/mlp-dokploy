import { loadClient, SAAS_EMAIL_DOMAIN, saasEnv } from "../saas";
import { GROUPS, groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

export const OKTA_ENV = [
	"OKTA_E2E_ORG_URL",
	"OKTA_E2E_API_TOKEN",
	"OIDC_E2E_SAAS_PASSWORD",
];

export const oktaApi = async (pathName: string, init: RequestInit = {}) => {
	const response = await fetch(
		`${saasEnv("OKTA_E2E_ORG_URL").replace(/\/+$/, "")}${pathName}`,
		{
			...init,
			headers: {
				authorization: `SSWS ${saasEnv("OKTA_E2E_API_TOKEN")}`,
				accept: "application/json",
				"content-type": "application/json",
				...init.headers,
			},
		},
	);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Okta ${init.method ?? "GET"} ${pathName}: ${response.status} ${text.slice(0, 200)}`,
		);
	}
	return text ? JSON.parse(text) : null;
};

export const oktaUsers = () =>
	testUsers(SAAS_EMAIL_DOMAIN, globalThis.process.env.OIDC_E2E_SAAS_PASSWORD);

/** Test users sign in with their email as login. */
const loginOf = (role: TestUserRole) => oktaUsers()[role].email;

export const oktaGroupId = async (name: string) => {
	const groups = (await oktaApi(
		`/api/v1/groups?q=${encodeURIComponent(name)}`,
	)) as { id: string; profile: { name: string } }[];
	return groups.find((group) => group.profile.name === name)?.id;
};

export const driver: ProviderDriver = {
	id: "okta",
	kind: "saas",
	version: "saas",
	requiredEnv: OKTA_ENV,
	moduleConfig: () => {
		const client = loadClient("okta");
		return {
			issuerUrl: saasEnv("OKTA_E2E_ORG_URL").replace(/\/+$/, ""),
			clientId: client.clientId,
			clientSecret: client.clientSecret,
			groupsClaim: "groups",
			extraScopes: "groups",
			allowInsecureHttp: false,
			...groupSettings,
		};
	},
	get users() {
		return Object.fromEntries(
			Object.entries(oktaUsers()).map(([role, user]) => [
				role,
				{ ...user, username: user.email },
			]),
		) as ProviderDriver["users"];
	},
	async moveUser(role: TestUserRole, toGroup: string) {
		const user = (await oktaApi(
			`/api/v1/users/${encodeURIComponent(loginOf(role))}`,
		)) as { id: string };
		for (const name of Object.values(GROUPS)) {
			const groupId = await oktaGroupId(name);
			if (!groupId) continue;
			await oktaApi(`/api/v1/groups/${groupId}/users/${user.id}`, {
				method: name === toGroup ? "PUT" : "DELETE",
			}).catch((error) => {
				if (name === toGroup) throw error;
			});
		}
	},
	// Identifier-first Sign-In Widget; the seed's policy asks for a password only.
	async login(page, user) {
		await page.fill('input[name="identifier"]', user.username);
		await page.click('input[type="submit"], button[type="submit"]');
		await page.fill('input[name="credentials.passcode"]', user.password);
		await page.click('input[type="submit"], button[type="submit"]');
	},
};
