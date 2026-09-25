import { db } from "@dokploy/server/db";
import { account, member } from "@dokploy/server/db/schema";
import type { BetterAuthPlugin } from "better-auth";
import { and, desc, eq } from "drizzle-orm";
import { drizzleProvisioningStore } from "../identity/provisioning";
import { getKeycloakSsoServices } from "../services";
import { KEYCLOAK_PROVIDER_ID } from "../types";
import {
	createKeycloakEndpoints,
	type KeycloakEndpointDeps,
} from "./endpoints";
import { createSsoOnlyGuard } from "./sso-only-guard";

const findIdToken = async (userId: string): Promise<string | null> => {
	const linked = await db.query.account.findFirst({
		where: and(
			eq(account.userId, userId),
			eq(account.providerId, KEYCLOAK_PROVIDER_ID),
		),
		orderBy: [desc(account.updatedAt)],
	});
	return linked?.idToken ?? null;
};

const findOwnerEmail = async (): Promise<string | null> => {
	const owner = await db.query.member.findFirst({
		where: eq(member.role, "owner"),
		orderBy: (m, { asc }) => [asc(m.createdAt)],
		with: { user: { columns: { email: true } } },
	});
	return owner?.user?.email ?? null;
};

const defaultDeps = (): KeycloakEndpointDeps => ({
	services: getKeycloakSsoServices(),
	provisioningStore: drizzleProvisioningStore,
	findIdToken,
	findOwnerEmail,
});

export interface KeycloakSsoPluginOptions {
	/** Overridable for tests; production resolves the shared singletons lazily. */
	resolveDeps?: () => KeycloakEndpointDeps;
}

export const keycloakSso = (options: KeycloakSsoPluginOptions = {}) => {
	const resolveDeps = options.resolveDeps ?? defaultDeps;
	return {
		id: "keycloak-sso",
		endpoints: createKeycloakEndpoints(resolveDeps),
		hooks: createSsoOnlyGuard(resolveDeps),
		rateLimit: [
			{
				pathMatcher: (path: string) => path.startsWith("/keycloak/"),
				window: 60,
				max: 20,
			},
		],
	} satisfies BetterAuthPlugin;
};
