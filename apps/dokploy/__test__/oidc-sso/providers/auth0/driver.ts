import { loadClient, SAAS_EMAIL_DOMAIN, saasEnv } from "../saas";
import { GROUPS, groupSettings, testUsers } from "../shared";
import type { ProviderDriver, TestUserRole } from "../types";

export const AUTH0_ENV = [
	"AUTH0_E2E_DOMAIN",
	"AUTH0_E2E_MGMT_CLIENT_ID",
	"AUTH0_E2E_MGMT_CLIENT_SECRET",
	"OIDC_E2E_SAAS_PASSWORD",
];

const domain = () => saasEnv("AUTH0_E2E_DOMAIN").replace(/^https?:\/\//, "");

let token: string | null = null;
const managementToken = async () => {
	if (token) return token;
	const response = await fetch(`https://${domain()}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			grant_type: "client_credentials",
			client_id: saasEnv("AUTH0_E2E_MGMT_CLIENT_ID"),
			client_secret: saasEnv("AUTH0_E2E_MGMT_CLIENT_SECRET"),
			audience: `https://${domain()}/api/v2/`,
		}),
	});
	if (!response.ok)
		throw new Error(`Auth0 management token: ${response.status}`);
	token = ((await response.json()) as { access_token: string }).access_token;
	return token;
};

export const auth0Api = async (pathName: string, init: RequestInit = {}) => {
	const response = await fetch(`https://${domain()}/api/v2${pathName}`, {
		...init,
		headers: {
			authorization: `Bearer ${await managementToken()}`,
			"content-type": "application/json",
			...init.headers,
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Auth0 ${init.method ?? "GET"} ${pathName}: ${response.status} ${text.slice(0, 200)}`,
		);
	}
	return text ? JSON.parse(text) : null;
};

export const auth0Users = () =>
	testUsers(SAAS_EMAIL_DOMAIN, globalThis.process.env.OIDC_E2E_SAAS_PASSWORD);

export const auth0RoleIds = async () => {
	const roles = (await auth0Api("/roles?per_page=100")) as {
		id: string;
		name: string;
	}[];
	return Object.fromEntries(roles.map((role) => [role.name, role.id]));
};

export const auth0UserId = async (email: string) => {
	const [user] = (await auth0Api(
		`/users-by-email?email=${encodeURIComponent(email)}`,
	)) as { user_id: string }[];
	return user?.user_id;
};

export const driver: ProviderDriver = {
	id: "auth0",
	kind: "saas",
	version: "saas",
	requiredEnv: AUTH0_ENV,
	// Groups arrive as roles in a namespaced claim set by action.js.
	moduleConfig: () => {
		const client = loadClient("auth0");
		return {
			issuerUrl: `https://${domain()}/`,
			clientId: client.clientId,
			clientSecret: client.clientSecret,
			groupsClaim: "https://dokploy/groups",
			extraScopes: "",
			allowInsecureHttp: false,
			...groupSettings,
		};
	},
	get users() {
		return Object.fromEntries(
			Object.entries(auth0Users()).map(([role, user]) => [
				role,
				{ ...user, username: user.email },
			]),
		) as ProviderDriver["users"];
	},
	async moveUser(role: TestUserRole, toGroup: string) {
		const userId = await auth0UserId(auth0Users()[role].email);
		const roleIds = await auth0RoleIds();
		const managed = Object.values(GROUPS)
			.map((name) => roleIds[name])
			.filter(Boolean);
		await auth0Api(`/users/${encodeURIComponent(userId ?? "")}/roles`, {
			method: "DELETE",
			body: JSON.stringify({ roles: managed }),
		});
		await auth0Api(`/users/${encodeURIComponent(userId ?? "")}/roles`, {
			method: "POST",
			body: JSON.stringify({ roles: [roleIds[toGroup]] }),
		});
	},
	// Universal Login: identifier, then password; localhost callbacks show a consent screen.
	async login(page, user) {
		await page.fill("#username", user.username);
		await page.click('button[type="submit"][name="action"]');
		await page.fill("#password", user.password);
		await page.click('button[type="submit"][name="action"]');
		const accept = page.locator('button[value="accept"]');
		if (await accept.isVisible({ timeout: 5_000 }).catch(() => false)) {
			await accept.click();
		}
	},
};
