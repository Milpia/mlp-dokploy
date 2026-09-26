import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderId } from "./types";

/** Hosted tenants: test users live on a dedicated test domain. */
export const SAAS_EMAIL_DOMAIN = "dokploy-e2e.test";

export const saasEnv = (name: string) => {
	const value = globalThis.process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
};

/**
 * The client credentials a seed obtained, handed to the battery process.
 * Kept in the OS temp directory with mode 600, never in the repository.
 */
const clientFile = (id: ProviderId) =>
	path.join(tmpdir(), `oidc-e2e-${id}-client.json`);

export const saveClient = (
	id: ProviderId,
	client: { clientId: string; clientSecret: string },
) => {
	const file = clientFile(id);
	writeFileSync(file, JSON.stringify(client), { mode: 0o600 });
	chmodSync(file, 0o600);
};

export const loadClient = (id: ProviderId) =>
	JSON.parse(readFileSync(clientFile(id), "utf8")) as {
		clientId: string;
		clientSecret: string;
	};
