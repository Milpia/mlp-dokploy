import { KeycloakConfigProvider } from "@dokploy/server/keycloak-sso/config/provider";
import {
	type ConfigRepository,
	DEFAULT_STORED_CONFIG,
} from "@dokploy/server/keycloak-sso/config/repository";
import {
	type AuthEventInput,
	AuthEventRecorder,
} from "@dokploy/server/keycloak-sso/events/auth-events";
import type { ProvisioningStore } from "@dokploy/server/keycloak-sso/identity/provisioning";
import type { OidcClient } from "@dokploy/server/keycloak-sso/oidc/client";
import type { KeycloakEndpointDeps } from "@dokploy/server/keycloak-sso/plugin/endpoints";
import type { KeycloakSsoServices } from "@dokploy/server/keycloak-sso/services";
import type { StoredConfig } from "@dokploy/server/keycloak-sso/types";
import { vi } from "vitest";

export const ISSUER = "https://kc.example.com/realms/milpia";

export const activeConfig: StoredConfig = {
	...DEFAULT_STORED_CONFIG,
	mode: "button",
	issuerUrl: ISSUER,
	clientId: "dokploy",
	clientSecret: "secret",
	accessGroup: "dokploy-users",
	adminGroup: "dokploy-admins",
};

export const memoryRepository = (initial: StoredConfig = activeConfig) => {
	let state = { ...initial };
	const repository: ConfigRepository = {
		get: vi.fn(async () => ({ ...state })),
		save: vi.fn(async (patch) => {
			state = { ...state, ...patch } as StoredConfig;
			return { ...state };
		}),
	};
	return repository;
};

export const fakeOidc = (overrides: Partial<OidcClient> = {}) => {
	const oidc = {
		createAuthorizationRequest: vi.fn(async () => ({
			url: `${ISSUER}/protocol/openid-connect/auth?state=st`,
			state: "st",
			nonce: "no",
			codeVerifier: "pkce-verifier-plaintext-marker",
		})),
		exchangeCode: vi.fn(async () => ({
			claims: {
				sub: "sub-1",
				email: "dev@example.com",
				email_verified: true,
				groups: ["/dokploy-users"],
			},
			idToken: "id-token",
		})),
		buildEndSessionUrl: vi.fn(
			async () => `${ISSUER}/protocol/openid-connect/logout?x=1`,
		),
		testConnection: vi.fn(async () => ({ ok: true as const, issuer: ISSUER })),
		reset: vi.fn(),
		...overrides,
	};
	return oidc;
};

export const fakeEvents = () => {
	const recorded: AuthEventInput[] = [];
	const recorder = new AuthEventRecorder({
		insert: async (event) => {
			recorded.push(event);
		},
		listRecent: async () => [],
		deleteOlderThan: async () => {},
	});
	return { recorder, recorded };
};

export const makeServices = ({
	config = activeConfig,
	oidc = fakeOidc(),
	env = { values: {}, errors: [] },
}: {
	config?: StoredConfig;
	oidc?: ReturnType<typeof fakeOidc>;
	env?: ConstructorParameters<typeof KeycloakConfigProvider>[0]["env"];
} = {}) => {
	const repository = memoryRepository(config);
	const events = fakeEvents();
	const services: KeycloakSsoServices = {
		config: new KeycloakConfigProvider({
			repository,
			env,
			isCloud: false,
			hasEnterpriseLicense: async () => false,
		}),
		events: events.recorder,
		oidc,
	};
	return { services, repository, oidc, recorded: events.recorded };
};

export const fakeProvisioningStore = (
	overrides: Partial<ProvisioningStore> = {},
): ProvisioningStore => ({
	findOwner: vi.fn(async () => ({ userId: "owner-id", organizationId: "org" })),
	findUserBySub: vi.fn(async () => null),
	findUserByEmail: vi.fn(async () => null),
	transaction: vi.fn(async (fn) =>
		fn({
			createUser: vi.fn(async () => "new-user-id"),
			upsertKeycloakAccount: vi.fn(async () => {}),
			ensureMembership: vi.fn(async () => {}),
		}),
	),
	...overrides,
});

export const makeDeps = (
	options: Parameters<typeof makeServices>[0] & {
		store?: ProvisioningStore;
		idToken?: string | null;
	} = {},
) => {
	const built = makeServices(options);
	const deps: KeycloakEndpointDeps = {
		services: built.services,
		provisioningStore: options.store ?? fakeProvisioningStore(),
		findIdToken: vi.fn(async () => options.idToken ?? null),
	};
	return { ...built, deps };
};
