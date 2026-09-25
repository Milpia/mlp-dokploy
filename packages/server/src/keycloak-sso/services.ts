import { IS_CLOUD } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import { member } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { readEnvOverrides } from "./config/env";
import { KeycloakConfigProvider } from "./config/provider";
import { drizzleConfigRepository } from "./config/repository";
import { AuthEventRecorder, drizzleAuthEventStore } from "./events/auth-events";
import { createOpenIdClient, type OidcClient } from "./oidc/client";

export interface KeycloakSsoServices {
	config: KeycloakConfigProvider;
	events: AuthEventRecorder;
	oidc: OidcClient;
}

/**
 * Read from upstream columns on the owner's user row rather than from the
 * proprietary license service, which this module must not import.
 */
export const ownerHasEnterpriseLicense = async (): Promise<boolean> => {
	const owner = await db.query.member.findFirst({
		where: eq(member.role, "owner"),
		with: { user: true },
	});
	return !!(
		owner?.user?.enableEnterpriseFeatures && owner.user.isValidEnterpriseLicense
	);
};

const createServices = (): KeycloakSsoServices => {
	const env = readEnvOverrides();
	for (const error of env.errors) {
		console.error(`Keycloak SSO: ${error}`);
	}
	return {
		config: new KeycloakConfigProvider({
			repository: drizzleConfigRepository,
			env,
			isCloud: IS_CLOUD,
			hasEnterpriseLicense: ownerHasEnterpriseLicense,
		}),
		events: new AuthEventRecorder(drizzleAuthEventStore),
		oidc: createOpenIdClient(),
	};
};

// Shared across duplicated bundles (Next.js pages and the custom server) so a
// save in one invalidates the cache the others read, like the auth instance.
const globalForKeycloak = globalThis as unknown as {
	keycloakSsoServices?: KeycloakSsoServices;
};

export const getKeycloakSsoServices = (): KeycloakSsoServices => {
	if (!globalForKeycloak.keycloakSsoServices) {
		globalForKeycloak.keycloakSsoServices = createServices();
	}
	return globalForKeycloak.keycloakSsoServices;
};
