import type { BetterAuthPlugin } from "better-auth";
import {
	drizzleProvisioningStore,
	findOwnerEmail,
	findSsoIdToken,
} from "../identity/provisioning";
import { getOidcSsoServices } from "../services";
import {
	defaultUserManagementGuardDeps,
	type UserManagementGuardDeps,
} from "../user-management/guard";
import { createEmergencyOriginHandler } from "./emergency-origin";
import { createSsoEndpoints, type SsoEndpointDeps } from "./endpoints";
import { createSsoOnlyGuard } from "./sso-only-guard";
import { createUserManagementHook } from "./user-management-hook";

const defaultDeps = (): SsoEndpointDeps => ({
	services: getOidcSsoServices(),
	provisioningStore: drizzleProvisioningStore,
	findIdToken: findSsoIdToken,
	findOwnerEmail,
});

export interface OidcSsoPluginOptions {
	/** Overridable for tests; production resolves the shared singletons lazily. */
	resolveDeps?: () => SsoEndpointDeps;
	resolveUserManagementDeps?: () => UserManagementGuardDeps;
}

export const oidcSso = (options: OidcSsoPluginOptions = {}) => {
	const resolveDeps = options.resolveDeps ?? defaultDeps;
	const resolveUserManagementDeps =
		options.resolveUserManagementDeps ?? defaultUserManagementGuardDeps;
	const ssoOnlyGuard = createSsoOnlyGuard(resolveDeps);
	return {
		id: "oidc-sso",
		endpoints: createSsoEndpoints(resolveDeps),
		hooks: {
			...ssoOnlyGuard,
			before: [
				...ssoOnlyGuard.before,
				createUserManagementHook(resolveUserManagementDeps),
			],
		},
		onRequest: createEmergencyOriginHandler(resolveDeps),
		rateLimit: [
			{
				pathMatcher: (path: string) => path.startsWith("/oidc/"),
				window: 60,
				max: 20,
			},
		],
	} satisfies BetterAuthPlugin;
};
