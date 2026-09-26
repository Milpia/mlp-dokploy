/**
 * Idempotent seed of the Okta test tenant through the Management API
 * (FR-008). Creates what is missing; never deletes anything else.
 */
import { saveClient } from "../saas";
import { GROUPS, POST_LOGOUT_URI, REDIRECT_URI } from "../shared";
import { oktaApi, oktaGroupId, oktaUsers } from "./driver";

const APP_LABEL = "dokploy-e2e";
/** Every test user, so the policies below reach them and nobody else. */
const ALL_USERS_GROUP = "dokploy-e2e";
const ENROLL_POLICY = "dokploy-e2e: no Okta Verify";
const ACCESS_POLICY = "dokploy-e2e: password only";

const findPolicy = async (type: string, name: string) => {
	const policies = (await oktaApi(`/api/v1/policies?type=${type}`)) as {
		id: string;
		name: string;
	}[];
	return policies.find((policy) => policy.name === name)?.id;
};

/**
 * The org authorization server has no API for its groups claim, so the test
 * uses the "default" custom authorization server with a groups claim on the
 * ID token (every group, filtered by Dokploy's own group settings).
 */
const AS_POLICY = "dokploy-e2e";

/** The default server only serves clients named in one of its policies. */
const ensureServerPolicy = async (clientId: string) => {
	const policies = (await oktaApi(
		"/api/v1/authorizationServers/default/policies",
	)) as { id: string; name: string }[];
	if (policies.some((policy) => policy.name === AS_POLICY)) return;
	const { id } = (await oktaApi(
		"/api/v1/authorizationServers/default/policies",
		{
			method: "POST",
			body: JSON.stringify({
				type: "OAUTH_AUTHORIZATION_POLICY",
				name: AS_POLICY,
				description: "Spec 004 battery",
				status: "ACTIVE",
				priority: 1,
				conditions: { clients: { include: [clientId] } },
			}),
		},
	)) as { id: string };
	await oktaApi(`/api/v1/authorizationServers/default/policies/${id}/rules`, {
		method: "POST",
		body: JSON.stringify({
			type: "RESOURCE_ACCESS",
			name: "authorization code",
			priority: 1,
			conditions: {
				people: { groups: { include: ["EVERYONE"] } },
				grantTypes: { include: ["authorization_code"] },
				scopes: { include: ["*"] },
			},
			actions: { token: { accessTokenLifetimeMinutes: 60 } },
		}),
	});
};

const ensureGroupsClaim = async () => {
	const claims = (await oktaApi(
		"/api/v1/authorizationServers/default/claims",
	)) as { name: string; claimType: string }[];
	if (claims.some((c) => c.name === "groups" && c.claimType === "IDENTITY")) {
		return;
	}
	await oktaApi("/api/v1/authorizationServers/default/claims", {
		method: "POST",
		body: JSON.stringify({
			name: "groups",
			status: "ACTIVE",
			claimType: "IDENTITY",
			valueType: "GROUPS",
			group_filter_type: "REGEX",
			value: ".*",
			alwaysIncludeInToken: true,
			conditions: { scopes: [] },
		}),
	});
};

/**
 * New Integrator orgs require Okta Verify at enrolment, and the default
 * access policy asks for it too; a headless browser cannot enrol. Both
 * policies are scoped to the test users and the test app only.
 */
const ensurePasswordOnly = async (appId: string, groupId: string) => {
	if (!(await findPolicy("MFA_ENROLL", ENROLL_POLICY))) {
		const { id } = (await oktaApi("/api/v1/policies", {
			method: "POST",
			body: JSON.stringify({
				type: "MFA_ENROLL",
				name: ENROLL_POLICY,
				priority: 1,
				conditions: { people: { groups: { include: [groupId] } } },
				settings: {
					type: "AUTHENTICATORS",
					authenticators: [
						{ key: "okta_password", enroll: { self: "REQUIRED" } },
						// Okta refuses NOT_ALLOWED while Okta Verify is the only MFA
						// authenticator for sign-in; optional lets the driver skip it.
						{ key: "okta_verify", enroll: { self: "OPTIONAL" } },
					],
				},
			}),
		})) as { id: string };
		await oktaApi(`/api/v1/policies/${id}/rules`, {
			method: "POST",
			body: JSON.stringify({
				type: "MFA_ENROLL",
				name: "dokploy-e2e",
				conditions: { people: { users: { exclude: [] } } },
				actions: { enroll: { self: "LOGIN" } },
			}),
		});
	}
	let accessId = await findPolicy("ACCESS_POLICY", ACCESS_POLICY);
	if (!accessId) {
		accessId = (
			(await oktaApi("/api/v1/policies", {
				method: "POST",
				body: JSON.stringify({ type: "ACCESS_POLICY", name: ACCESS_POLICY }),
			})) as { id: string }
		).id;
		await oktaApi(`/api/v1/policies/${accessId}/rules`, {
			method: "POST",
			body: JSON.stringify({
				type: "ACCESS_POLICY",
				name: "password only",
				priority: 1,
				actions: {
					appSignOn: {
						access: "ALLOW",
						verificationMethod: {
							factorMode: "1FA",
							type: "ASSURANCE",
							reauthenticateIn: "PT2H",
							constraints: [{ knowledge: { types: ["password"] } }],
						},
					},
				},
			}),
		});
	}
	await oktaApi(`/api/v1/apps/${appId}/policies/${accessId}`, {
		method: "PUT",
	});
};

const USER_GROUPS: Record<string, string[]> = {
	member: [GROUPS.access],
	admin: [GROUPS.admin],
	outsider: [],
	manager: [GROUPS.admin, GROUPS.management],
};

export const seed = async () => {
	const groupIds: Record<string, string> = {};
	for (const name of [...Object.values(GROUPS), ALL_USERS_GROUP]) {
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
		// Secrets cannot be read back: add a fresh one for this run. Okta keeps at
		// most two per app, so the oldest goes first.
		const secrets = (await oktaApi(
			`/api/v1/apps/${app.id}/credentials/secrets`,
		)) as { id: string; created: string; status: string }[];
		if (secrets.length >= 2) {
			const oldest = [...secrets].sort((a, b) =>
				a.created.localeCompare(b.created),
			)[0] as { id: string; status: string };
			if (oldest.status === "ACTIVE") {
				await oktaApi(
					`/api/v1/apps/${app.id}/credentials/secrets/${oldest.id}/lifecycle/deactivate`,
					{ method: "POST" },
				);
			}
			await oktaApi(`/api/v1/apps/${app.id}/credentials/secrets/${oldest.id}`, {
				method: "DELETE",
			});
		}
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
		await oktaApi(
			`/api/v1/groups/${groupIds[ALL_USERS_GROUP]}/users/${userId}`,
			{
				method: "PUT",
			},
		);
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

	await ensurePasswordOnly(app.id, groupIds[ALL_USERS_GROUP] as string);
	await ensureGroupsClaim();
	await ensureServerPolicy(appDetails.credentials.oauthClient.client_id);

	saveClient("okta", {
		clientId: appDetails.credentials.oauthClient.client_id,
		clientSecret,
	});
};
