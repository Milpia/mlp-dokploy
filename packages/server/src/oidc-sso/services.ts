import { IS_CLOUD } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import { member } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { readEnvOverrides } from "./config/env";
import { SsoConfigProvider } from "./config/provider";
import { drizzleConfigRepository } from "./config/repository";
import { AuthEventRecorder, drizzleAuthEventStore } from "./events/auth-events";
import { drizzleProvisioningStore } from "./identity/provisioning";
import { createOpenIdClient, type OidcClient } from "./oidc/client";

export interface OidcSsoServices {
	config: SsoConfigProvider;
	events: AuthEventRecorder;
	oidc: OidcClient;
	/**
	 * The instance owner (oldest owner membership). Owning *an* organization
	 * is not enough: any admin can create one and own it.
	 */
	instanceOwnerId(): Promise<string | null>;
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

const createServices = (): OidcSsoServices => {
	const env = readEnvOverrides();
	for (const error of env.errors) {
		console.error(`OIDC SSO: ${error}`);
	}
	return {
		config: new SsoConfigProvider({
			repository: drizzleConfigRepository,
			env,
			isCloud: IS_CLOUD,
			hasEnterpriseLicense: ownerHasEnterpriseLicense,
		}),
		events: new AuthEventRecorder(drizzleAuthEventStore),
		oidc: createOpenIdClient(),
		instanceOwnerId: async () =>
			(await drizzleProvisioningStore.findOwner())?.userId ?? null,
	};
};

// Shared across duplicated bundles (Next.js pages and the custom server) so a
// save in one invalidates the cache the others read, like the auth instance.
const globalForOidcSso = globalThis as unknown as {
	oidcSsoServices?: OidcSsoServices;
};

export const getOidcSsoServices = (): OidcSsoServices => {
	if (!globalForOidcSso.oidcSsoServices) {
		globalForOidcSso.oidcSsoServices = createServices();
	}
	return globalForOidcSso.oidcSsoServices;
};
