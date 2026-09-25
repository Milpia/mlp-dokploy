import { SsoConfigProvider } from "@dokploy/server/oidc-sso/config/provider";
import {
	type ConfigRepository,
	DEFAULT_STORED_CONFIG,
} from "@dokploy/server/oidc-sso/config/repository";
import {
	type AuthEventInput,
	AuthEventRecorder,
} from "@dokploy/server/oidc-sso/events/auth-events";
import type { ProvisioningStore } from "@dokploy/server/oidc-sso/identity/provisioning";
import type { OidcClient } from "@dokploy/server/oidc-sso/oidc/client";
import type { SsoEndpointDeps } from "@dokploy/server/oidc-sso/plugin/endpoints";
import type { OidcSsoServices } from "@dokploy/server/oidc-sso/services";
import type { StoredConfig } from "@dokploy/server/oidc-sso/types";
import { type Mock, vi } from "vitest";

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

export type MockedOidc = { [K in keyof OidcClient]: Mock<OidcClient[K]> };

export const fakeOidc = (
	overrides: { [K in keyof OidcClient]?: OidcClient[K] } = {},
): MockedOidc => {
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
	return oidc as unknown as MockedOidc;
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
	env?: ConstructorParameters<typeof SsoConfigProvider>[0]["env"];
} = {}) => {
	const repository = memoryRepository(config);
	const events = fakeEvents();
	const services: OidcSsoServices = {
		config: new SsoConfigProvider({
			repository,
			env,
			isCloud: false,
			hasEnterpriseLicense: async () => false,
		}),
		events: events.recorder,
		oidc,
		instanceOwnerId: async () => "owner-id",
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
			upsertSsoAccount: vi.fn(async () => {}),
			ensureMembership: vi.fn(async () => {}),
		}),
	),
	...overrides,
});

export const makeDeps = (
	options: Parameters<typeof makeServices>[0] & {
		store?: ProvisioningStore;
		idToken?: string | null;
		ownerEmail?: string | null;
	} = {},
) => {
	const built = makeServices(options);
	const deps: SsoEndpointDeps = {
		services: built.services,
		provisioningStore: options.store ?? fakeProvisioningStore(),
		findIdToken: vi.fn(async () => options.idToken ?? null),
		findOwnerEmail: vi.fn(async () =>
			options.ownerEmail === undefined
				? "owner@example.com"
				: options.ownerEmail,
		),
	};
	return { ...built, deps };
};
