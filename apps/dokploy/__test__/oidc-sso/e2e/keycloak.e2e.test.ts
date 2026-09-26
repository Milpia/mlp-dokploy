/**
 * End-to-end tests against a real Keycloak (NFR-QA-002). Opt-in:
 *
 *   docker run --rm -d --name kc-e2e -p 8080:8080 \
 *     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
 *     -v "$PWD/__test__/oidc-sso/e2e/realm-dokploy-test.json:/opt/keycloak/data/import/realm.json" \
 *     quay.io/keycloak/keycloak:26.0 start-dev --import-realm
 *   KEYCLOAK_E2E=1 pnpm exec vitest --config __test__/vitest.config.ts run oidc-sso/e2e
 *
 * The browser is simulated with fetch and two cookie jars (Dokploy and
 * Keycloak), so the real authorization code + PKCE flow, ID token validation
 * and group mapper are exercised end to end.
 */
import { SsoConfigProvider } from "@dokploy/server/oidc-sso/config/provider";
import type {
	ProvisioningStore,
	ProvisioningTx,
} from "@dokploy/server/oidc-sso/identity/provisioning";
import { createOpenIdClient } from "@dokploy/server/oidc-sso/oidc/client";
import type { SsoEndpointDeps } from "@dokploy/server/oidc-sso/plugin/endpoints";
import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeAll, describe, expect, it } from "vitest";
import { activeConfig, fakeEvents, memoryRepository } from "../helpers";

// vitest.config.ts replaces `process.env` with a fixed object at build time;
// globalThis.process.env is the real environment.
const runtimeEnv = globalThis.process.env;
const enabled = runtimeEnv.KEYCLOAK_E2E === "1";
const KEYCLOAK = runtimeEnv.KEYCLOAK_E2E_URL ?? "http://localhost:8080";
const ISSUER = `${KEYCLOAK}/realms/dokploy-test`;
const BASE = "http://localhost:3000";
const PASSWORD = "Passw0rd!";

type Jar = Map<string, string>;

const store = (jar: Jar, response: Response) => {
	for (const cookie of response.headers.getSetCookie()) {
		const [pair] = cookie.split(";");
		const index = pair?.indexOf("=") ?? -1;
		if (!pair || index < 1) continue;
		const name = pair.slice(0, index);
		const value = pair.slice(index + 1);
		if (value) jar.set(name, value);
		else jar.delete(name);
	}
};

const header = (jar: Jar) =>
	[...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

type Row = Record<string, unknown>;

/**
 * Provisioning over the same in-memory tables better-auth uses, so users the
 * flow creates exist when the session is issued.
 */
const memoryProvisioningStore = (tables: { user: Row[] }) => {
	const roles = new Map<string, string>([["owner-id", "owner"]]);
	const subs = new Map<string, string>();
	const findUser = (id: string) => tables.user.find((u) => u.id === id);
	const tx: ProvisioningTx = {
		async createUser({ email }) {
			const id = `user-${tables.user.length}`;
			const now = new Date();
			tables.user.push({
				id,
				email,
				name: email,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			return id;
		},
		async upsertSsoAccount({ userId, sub }) {
			subs.set(sub, userId);
		},
		async ensureMembership({ userId, role }) {
			if (roles.get(userId) === "owner") return;
			roles.set(userId, role ?? roles.get(userId) ?? "member");
		},
		async recordLoginState() {},
	};
	const provisioning: ProvisioningStore = {
		findOwner: async () => ({ userId: "owner-id", organizationId: "org" }),
		findUserBySub: async (sub) => {
			const id = subs.get(sub);
			return id && findUser(id) ? { id, banned: false } : null;
		},
		findUserByEmail: async (email) => {
			const user = tables.user.find((u) => u.email === email);
			if (!user) return null;
			const id = user.id as string;
			const linkedSub =
				[...subs.entries()].find(([, userId]) => userId === id)?.[0] ?? null;
			return { id, banned: false, linkedSub };
		},
		transaction: (fn) => fn(tx),
	};
	const roleOf = (email: string) => {
		const user = tables.user.find((u) => u.email === email);
		return user ? roles.get(user.id as string) : undefined;
	};
	return { provisioning, roleOf };
};

const setup = () => {
	const repository = memoryRepository({
		...activeConfig,
		issuerUrl: ISSUER,
		clientSecret: "dokploy-secret",
		allowInsecureHttp: true,
	});
	const events = fakeEvents();
	const now = new Date();
	const tables = {
		user: [
			{
				id: "owner-id",
				email: "owner@example.com",
				name: "Owner",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		] as Row[],
		session: [] as Row[],
		account: [] as Row[],
		verification: [] as Row[],
	};
	const { provisioning, roleOf } = memoryProvisioningStore(tables);
	const deps: SsoEndpointDeps = {
		services: {
			config: new SsoConfigProvider({
				repository,
				env: { values: {}, errors: [] },
				isCloud: false,
				hasEnterpriseLicense: async () => false,
			}),
			events: events.recorder,
			oidc: createOpenIdClient(),
			instanceOwnerId: async () => "owner-id",
			emergencyOrigin: null,
		},
		provisioningStore: provisioning,
		findIdToken: async () => null,
		findOwnerEmail: async () => "owner@example.com",
	};
	const auth = betterAuth({
		baseURL: BASE,
		secret: "e2e-secret-that-is-long-enough-for-better-auth",
		database: memoryAdapter(tables),
		rateLimit: { enabled: false },
		logger: { disabled: true },
		plugins: [oidcSso({ resolveDeps: () => deps })],
	});
	return { auth, deps, repository, roleOf, events: events.recorded };
};

/** Runs the full browser round trip and returns the final Dokploy response. */
const login = async (
	ctx: ReturnType<typeof setup>,
	username: string,
	returnTo = "/dashboard/projects",
) => {
	const dokploy: Jar = new Map();
	const keycloak: Jar = new Map();

	const start = await ctx.auth.handler(
		new Request(
			`${BASE}/api/auth/oidc/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
		),
	);
	store(dokploy, start);
	const authorizeUrl = start.headers.get("location") ?? "";
	expect(authorizeUrl.startsWith(ISSUER)).toBe(true);

	const loginPage = await fetch(authorizeUrl, { redirect: "manual" });
	store(keycloak, loginPage);
	const html = await loginPage.text();
	const action = /action="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
	expect(action).toBeTruthy();

	const submitted = await fetch(action as string, {
		method: "POST",
		redirect: "manual",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			cookie: header(keycloak),
		},
		body: new URLSearchParams({
			username,
			password: PASSWORD,
			credentialId: "",
		}),
	});
	const callback = submitted.headers.get("location") ?? "";
	expect(callback.startsWith(`${BASE}/api/auth/oidc/callback`)).toBe(true);

	return ctx.auth.handler(
		new Request(callback, { headers: { cookie: header(dokploy) } }),
	);
};

describe.skipIf(!enabled)("Keycloak end-to-end (NFR-QA-002)", () => {
	let ctx: ReturnType<typeof setup>;

	beforeAll(async () => {
		const discovery = await fetch(
			`${ISSUER}/.well-known/openid-configuration`,
		).catch(() => null);
		if (!discovery?.ok) {
			throw new Error(
				`Keycloak is not reachable at ${ISSUER}; start it as described at the top of this file.`,
			);
		}
	});

	it("FR-014: the connection test succeeds against the realm", async () => {
		ctx = setup();
		await expect(
			ctx.deps.services.oidc.testConnection({
				issuerUrl: ISSUER,
				clientId: "dokploy",
				clientSecret: "dokploy-secret",
				allowInsecureHttp: true,
			}),
		).resolves.toMatchObject({ ok: true, issuer: ISSUER });
	});

	it("FR-014: a wrong secret is reported as invalid_client", async () => {
		ctx = setup();
		await expect(
			ctx.deps.services.oidc.testConnection({
				issuerUrl: ISSUER,
				clientId: "dokploy",
				clientSecret: "wrong",
				allowInsecureHttp: true,
			}),
		).resolves.toMatchObject({ ok: false, code: "invalid_client" });
	});

	it("US1/SC-001: the owner signs in, lands on the requested page in under 5 s and verifies the issuer", async () => {
		ctx = setup();
		const t0 = performance.now();
		const response = await login(ctx, "owner", "/dashboard/projects");
		const elapsed = performance.now() - t0;
		expect(response.headers.get("location")).toBe("/dashboard/projects");
		expect(elapsed).toBeLessThan(5_000);
		expect(ctx.roleOf("owner@example.com")).toBe("owner");
		expect((await ctx.repository.get()).verifiedIssuer).toBe(ISSUER);
	});

	it("FR-008: a member of dokploy-admins becomes admin", async () => {
		ctx = setup();
		await login(ctx, "admin");
		expect(ctx.roleOf("admin@example.com")).toBe("admin");
		expect(ctx.events.at(-1)).toMatchObject({
			type: "sso_login",
			outcome: "success",
		});
	});

	it("FR-007: a member of dokploy-users only becomes member", async () => {
		ctx = setup();
		await login(ctx, "dev");
		expect(ctx.roleOf("dev@example.com")).toBe("member");
	});

	it("FR-007: a user outside the access group is denied", async () => {
		ctx = setup();
		const response = await login(ctx, "outsider");
		expect(response.headers.get("location")).toMatch(/error=sso_access_denied/);
	});

	it("FR-006: an unverified email is denied", async () => {
		ctx = setup();
		const response = await login(ctx, "unverified");
		expect(response.headers.get("location")).toMatch(
			/error=sso_email_unverified/,
		);
	});

	it("FR-010: builds the Keycloak end-session URL", async () => {
		ctx = setup();
		const url = await ctx.deps.services.oidc.buildEndSessionUrl(
			{
				issuerUrl: ISSUER,
				clientId: "dokploy",
				clientSecret: "dokploy-secret",
				allowInsecureHttp: true,
			},
			{ postLogoutRedirectUri: `${BASE}/` },
		);
		expect(url).toContain(`${ISSUER}/protocol/openid-connect/logout`);
	});

	it("NFR-PERF-006/SC-008: 50 concurrent logins succeed", async () => {
		ctx = setup();
		const results = await Promise.all(
			Array.from({ length: 50 }, () => login(ctx, "dev")),
		);
		const ok = results.filter(
			(r) => r.headers.get("location") === "/dashboard/projects",
		);
		expect(ok.length / results.length).toBeGreaterThanOrEqual(0.95);
	}, 120_000);
});
