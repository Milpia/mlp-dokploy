import type { BetterAuthPlugin } from "better-auth";
import {
	drizzleProvisioningStore,
	findKeycloakIdToken,
	findOwnerEmail,
} from "../identity/provisioning";
import { getKeycloakSsoServices } from "../services";
import {
	createKeycloakEndpoints,
	type KeycloakEndpointDeps,
} from "./endpoints";
import { createSsoOnlyGuard } from "./sso-only-guard";

const defaultDeps = (): KeycloakEndpointDeps => ({
	services: getKeycloakSsoServices(),
	provisioningStore: drizzleProvisioningStore,
	findIdToken: findKeycloakIdToken,
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
