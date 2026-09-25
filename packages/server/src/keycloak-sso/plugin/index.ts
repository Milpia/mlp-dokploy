import { db } from "@dokploy/server/db";
import { account } from "@dokploy/server/db/schema";
import type { BetterAuthPlugin } from "better-auth";
import { and, desc, eq } from "drizzle-orm";
import { drizzleProvisioningStore } from "../identity/provisioning";
import { getKeycloakSsoServices } from "../services";
import { KEYCLOAK_PROVIDER_ID } from "../types";
import {
	createKeycloakEndpoints,
	type KeycloakEndpointDeps,
} from "./endpoints";

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

const defaultDeps = (): KeycloakEndpointDeps => ({
	services: getKeycloakSsoServices(),
	provisioningStore: drizzleProvisioningStore,
	findIdToken,
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
		rateLimit: [
			{
				pathMatcher: (path: string) => path.startsWith("/keycloak/"),
				window: 60,
				max: 20,
			},
		],
	} satisfies BetterAuthPlugin;
};
