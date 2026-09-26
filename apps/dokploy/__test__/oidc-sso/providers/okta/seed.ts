/**
 * Idempotent seed of the Okta test tenant through the Management API
 * (FR-008). Creates what is missing; never deletes anything else.
 */
import { saveClient } from "../saas";
import { GROUPS, POST_LOGOUT_URI, REDIRECT_URI } from "../shared";
import { oktaApi, oktaGroupId, oktaUsers } from "./driver";

const APP_LABEL = "dokploy-e2e";

const USER_GROUPS: Record<string, string[]> = {
	member: [GROUPS.access],
	admin: [GROUPS.admin],
	outsider: [],
	manager: [GROUPS.admin, GROUPS.management],
};

export const seed = async () => {
	const groupIds: Record<string, string> = {};
	for (const name of Object.values(GROUPS)) {
		groupIds[name] =
			(await oktaGroupId(name)) ??
			(
				(await oktaApi("/api/v1/groups", {
					method: "POST",
					body: JSON.stringify({ profile: { name } }),
				})) as { id: string }
			).id;
	}

	const [existing] = (await oktaApi(
		`/api/v1/apps?q=${encodeURIComponent(APP_LABEL)}`,
	)) as { id: string; label: string }[];
	let app = existing?.label === APP_LABEL ? existing : undefined;
	let clientSecret: string;
	if (!app) {
		const created = (await oktaApi("/api/v1/apps", {
			method: "POST",
			body: JSON.stringify({
				name: "oidc_client",
				label: APP_LABEL,
				signOnMode: "OPENID_CONNECT",
				credentials: {
					oauthClient: { token_endpoint_auth_method: "client_secret_post" },
				},
				settings: {
					oauthClient: {
						redirect_uris: [REDIRECT_URI],
						post_logout_redirect_uris: [POST_LOGOUT_URI],
						response_types: ["code"],
						grant_types: ["authorization_code"],
						application_type: "web",
						consent_method: "TRUSTED",
					},
				},
				// Groups claim filter of the org authorization server [verificar].
				profile: {
					groupsClaim: {
						type: "FILTER",
						filter: "Matches regex .*",
						name: "groups",
					},
				},
			}),
		})) as {
			id: string;
			credentials: {
				oauthClient: { client_id: string; client_secret: string };
			};
		};
		app = { id: created.id, label: APP_LABEL };
		clientSecret = created.credentials.oauthClient.client_secret;
	} else {
		// Secrets cannot be read back: add a fresh one for this run.
		const secret = (await oktaApi(
			`/api/v1/apps/${app.id}/credentials/secrets`,
			{ method: "POST", body: "{}" },
		)) as { client_secret: string };
		clientSecret = secret.client_secret;
	}
	const appDetails = (await oktaApi(`/api/v1/apps/${app.id}`)) as {
		credentials: { oauthClient: { client_id: string } };
	};

	for (const [role, user] of Object.entries(oktaUsers())) {
		const found = await oktaApi(
			`/api/v1/users/${encodeURIComponent(user.email)}`,
		).catch(() => null);
		const userId =
			(found as { id: string } | null)?.id ??
			(
				(await oktaApi("/api/v1/users?activate=true", {
					method: "POST",
					body: JSON.stringify({
						profile: {
							firstName: role,
							lastName: "E2E",
							email: user.email,
							login: user.email,
						},
						credentials: { password: { value: user.password } },
					}),
				})) as { id: string }
			).id;
		for (const name of Object.values(GROUPS)) {
			const wanted = USER_GROUPS[role]?.includes(name);
			await oktaApi(`/api/v1/groups/${groupIds[name]}/users/${userId}`, {
				method: wanted ? "PUT" : "DELETE",
			}).catch((error) => {
				if (wanted) throw error;
			});
		}
		await oktaApi(`/api/v1/apps/${app.id}/users/${userId}`, {
			method: "PUT",
			body: "{}",
		}).catch(() => {});
	}

	saveClient("okta", {
		clientId: appDetails.credentials.oauthClient.client_id,
		clientSecret,
	});
};
