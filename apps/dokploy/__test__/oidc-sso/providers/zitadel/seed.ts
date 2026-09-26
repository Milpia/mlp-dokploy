import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_PASSWORD, GROUPS, POST_LOGOUT_URI, REDIRECT_URI } from "../shared";
import { api, runDir, type SeededApp } from "./driver";

const USER_GROUPS: Record<string, string[]> = {
	member: [GROUPS.access],
	admin: [GROUPS.admin],
	outsider: [],
	manager: [GROUPS.admin, GROUPS.management],
};

export const seed = async () => {
	const pat = path.join(runDir(), "admin.pat");
	const deadline = Date.now() + 5 * 60_000;
	while (!existsSync(pat)) {
		if (Date.now() > deadline) throw new Error("Zitadel wrote no admin PAT");
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}

	const { id: projectId } = (await api("/management/v1/projects", {
		method: "POST",
		body: JSON.stringify({
			name: "Dokploy",
			projectRoleAssertion: true,
			projectRoleCheck: false,
		}),
	})) as { id: string };
	await api(`/management/v1/projects/${projectId}/roles/_bulk`, {
		method: "POST",
		body: JSON.stringify({
			roles: Object.values(GROUPS).map((key) => ({ key, displayName: key })),
		}),
	});
	const app = (await api(`/management/v1/projects/${projectId}/apps/oidc`, {
		method: "POST",
		body: JSON.stringify({
			name: "dokploy",
			redirectUris: [REDIRECT_URI],
			postLogoutRedirectUris: [POST_LOGOUT_URI],
			responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
			grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
			appType: "OIDC_APP_TYPE_WEB",
			authMethodType: "OIDC_AUTH_METHOD_TYPE_POST",
			devMode: true,
			idTokenRoleAssertion: true,
			idTokenUserinfoAssertion: true,
		}),
	})) as { clientId: string; clientSecret: string };

	const userIds: Record<string, string> = {};
	for (const [username, roles] of Object.entries(USER_GROUPS)) {
		const { userId } = (await api("/management/v1/users/human/_import", {
			method: "POST",
			body: JSON.stringify({
				userName: username,
				profile: { firstName: username, lastName: "E2E" },
				email: { email: `${username}@e2e.test`, isEmailVerified: true },
				password: E2E_PASSWORD,
				passwordChangeRequired: false,
			}),
		})) as { userId: string };
		userIds[username] = userId;
		if (roles.length > 0) {
			await api(`/management/v1/users/${userId}/grants`, {
				method: "POST",
				body: JSON.stringify({ projectId, roleKeys: roles }),
			});
		}
	}

	const seededApp: SeededApp = {
		projectId,
		clientId: app.clientId,
		clientSecret: app.clientSecret,
		userIds,
	};
	writeFileSync(path.join(runDir(), "app.json"), JSON.stringify(seededApp));
};
