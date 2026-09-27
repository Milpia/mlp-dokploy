/**
 * Idempotent seed of the Auth0 test tenant through the Management API
 * (FR-008). Creates what is missing; never deletes anything else.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveClient } from "../saas";
import { GROUPS, POST_LOGOUT_URI, REDIRECT_URI } from "../shared";
import { auth0Api, auth0RoleIds, auth0UserId, auth0Users } from "./driver";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 120_000) => {
	const deadline = Date.now() + timeoutMs;
	while (!(await check())) {
		if (Date.now() > deadline)
			throw new Error("Auth0 action did not build in time");
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
};
const APP_NAME = "dokploy-e2e";
const ACTION_NAME = "dokploy-e2e-groups";

const USER_ROLES: Record<string, string[]> = {
	member: [GROUPS.access],
	admin: [GROUPS.admin],
	outsider: [],
	manager: [GROUPS.admin, GROUPS.management],
};

export const seed = async () => {
	let roleIds = await auth0RoleIds();
	for (const name of Object.values(GROUPS)) {
		if (roleIds[name]) continue;
		await auth0Api("/roles", {
			method: "POST",
			body: JSON.stringify({ name, description: "dokploy e2e" }),
		});
	}
	roleIds = await auth0RoleIds();

	const clients = (await auth0Api(
		"/clients?fields=client_id,client_secret,name&include_fields=true&per_page=100",
	)) as { client_id: string; client_secret?: string; name: string }[];
	const client =
		clients.find((candidate) => candidate.name === APP_NAME) ??
		((await auth0Api("/clients", {
			method: "POST",
			body: JSON.stringify({
				name: APP_NAME,
				app_type: "regular_web",
				callbacks: [REDIRECT_URI],
				allowed_logout_urls: [POST_LOGOUT_URI],
				token_endpoint_auth_method: "client_secret_post",
				grant_types: ["authorization_code"],
				oidc_conformant: true,
			}),
		})) as { client_id: string; client_secret: string; name: string });

	for (const [role, user] of Object.entries(auth0Users())) {
		const userId =
			(await auth0UserId(user.email)) ??
			(
				(await auth0Api("/users", {
					method: "POST",
					body: JSON.stringify({
						connection: "Username-Password-Authentication",
						email: user.email,
						password: user.password,
						email_verified: true,
					}),
				})) as { user_id: string }
			).user_id;
		const managed = Object.values(GROUPS)
			.map((name) => roleIds[name])
			.filter(Boolean);
		await auth0Api(`/users/${encodeURIComponent(userId)}/roles`, {
			method: "DELETE",
			body: JSON.stringify({ roles: managed }),
		});
		const wanted = (USER_ROLES[role] ?? []).map((name) => roleIds[name]);
		if (wanted.length > 0) {
			await auth0Api(`/users/${encodeURIComponent(userId)}/roles`, {
				method: "POST",
				body: JSON.stringify({ roles: wanted }),
			});
		}
	}

	const code = readFileSync(path.join(HERE, "action.js"), "utf8");
	const { actions = [] } = (await auth0Api(
		`/actions/actions?actionName=${ACTION_NAME}`,
	)) as {
		actions?: { id: string; code: string; all_changes_deployed?: boolean }[];
	};
	let action = actions[0];
	let changed = false;
	if (!action) {
		action = (await auth0Api("/actions/actions", {
			method: "POST",
			body: JSON.stringify({
				name: ACTION_NAME,
				supported_triggers: [{ id: "post-login", version: "v3" }],
				code,
				runtime: "node22",
			}),
		})) as { id: string; code: string };
		changed = true;
	} else if (action.code !== code) {
		await auth0Api(`/actions/actions/${action.id}`, {
			method: "PATCH",
			body: JSON.stringify({ code }),
		});
		changed = true;
	}
	if (changed || !action.all_changes_deployed) {
		// A new action must finish building before it can be deployed.
		await waitFor(async () => {
			const current = (await auth0Api(`/actions/actions/${action.id}`)) as {
				status: string;
			};
			return current.status === "built";
		});
		await auth0Api(`/actions/actions/${action.id}/deploy`, { method: "POST" });
		changed = true;
	}
	const { bindings = [] } = (await auth0Api(
		"/actions/triggers/post-login/bindings",
	)) as { bindings?: { display_name: string }[] };
	if (!bindings.some((binding) => binding.display_name === ACTION_NAME)) {
		await auth0Api("/actions/triggers/post-login/bindings", {
			method: "PATCH",
			body: JSON.stringify({
				bindings: [
					...bindings.map((binding) => ({
						ref: { type: "action_name", value: binding.display_name },
						display_name: binding.display_name,
					})),
					{
						ref: { type: "action_name", value: ACTION_NAME },
						display_name: ACTION_NAME,
					},
				],
			}),
		});
		changed = true;
	}
	// A new deployment or binding takes a few seconds to reach logins; without
	// the wait the first scenarios run with no groups claim.
	if (changed) await new Promise((resolve) => setTimeout(resolve, 20_000));

	if (!client.client_secret) {
		throw new Error(
			"Auth0 did not return the client secret (read:client_keys scope)",
		);
	}
	saveClient("auth0", {
		clientId: client.client_id,
		clientSecret: client.client_secret,
	});
};
