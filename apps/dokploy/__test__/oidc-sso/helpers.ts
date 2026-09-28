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
import type {
	ResolvedScope,
	ScopeCatalog,
} from "@dokploy/server/oidc-sso/member-profile/scope";
import type { MemberProfileStore } from "@dokploy/server/oidc-sso/member-profile/store";
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
	userManagementGroup: null,
	groupProfiles: null,
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
	const recorder = new AuthEventRecorder(
		{
			insert: async (event) => {
				recorded.push(event);
			},
			listRecent: async () => [],
			count: async () => 0,
			deleteOlderThan: async () => {},
		},
		{ logEvent: () => {} },
	);
	return { recorder, recorded };
};

export const makeServices = ({
	config = activeConfig,
	oidc = fakeOidc(),
	env = { values: {}, errors: [] },
	emergencyOrigin = null,
}: {
	config?: StoredConfig;
	oidc?: ReturnType<typeof fakeOidc>;
	env?: ConstructorParameters<typeof SsoConfigProvider>[0]["env"];
	emergencyOrigin?: string | null;
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
		emergencyOrigin,
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
			recordLoginState: vi.fn(async () => {}),
			applyGroupProfile: vi.fn(async () => "none" as const),
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

export interface MemoryProject {
	projectId: string;
	name: string;
	environments: Array<{
		environmentId: string;
		name: string;
		services: string[];
	}>;
}

/** The project catalog the e2e harness resolves group scopes against (spec 005). */
export const memoryScopeCatalog = (
	projects: MemoryProject[],
): ScopeCatalog => ({
	projectsByName: async (_organizationId, names) =>
		projects
			.filter((p) => names.includes(p.name))
			.map(({ projectId, name }) => ({ projectId, name })),
	environmentsOf: async (projectIds) =>
		projects
			.filter((p) => projectIds.includes(p.projectId))
			.flatMap((p) =>
				p.environments.map(({ environmentId, name }) => ({
					environmentId,
					projectId: p.projectId,
					name,
				})),
			),
	servicesOf: async (environmentIds) =>
		projects.flatMap((p) =>
			p.environments
				.filter((e) => environmentIds.includes(e.environmentId))
				.flatMap((e) => e.services),
		),
});

export interface MemoryGrant {
	groups: string[];
	permissions: string[];
	scope: ResolvedScope;
	appliedAt: Date;
	expiredAt: Date | null;
}

/** In-memory member profile store over a role map (spec 005). */
export const memoryMemberProfileStore = (roles: Map<string, string>) => {
	const grants = new Map<string, MemoryGrant>();
	const store: MemberProfileStore = {
		findRole: async (userId) => roles.get(userId) ?? null,
		findProfile: async (userId) => {
			const grant = grants.get(userId);
			return grant
				? {
						groups: grant.groups,
						appliedAt: grant.appliedAt,
						expiredAt: grant.expiredAt,
					}
				: null;
		},
		grant: async ({ userId, groups, permissions, scope, at }) => {
			grants.set(userId, {
				groups,
				permissions,
				scope,
				appliedAt: at,
				expiredAt: null,
			});
		},
		revoke: async ({ userId }) => {
			grants.delete(userId);
		},
		expire: async ({ userId, at }) => {
			const grant = grants.get(userId);
			if (grant) {
				grants.set(userId, {
					...grant,
					permissions: [],
					scope: {
						projectIds: [],
						environmentIds: [],
						serviceIds: [],
						readOnly: { environmentIds: [], serviceIds: [], projectIds: [] },
					},
					expiredAt: at,
				});
			}
		},
	};
	return { store, grants };
};
