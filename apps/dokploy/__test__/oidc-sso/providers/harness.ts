import { createServer } from "node:http";
import { SsoConfigProvider } from "@dokploy/server/oidc-sso/config/provider";
import type { LoginState } from "@dokploy/server/oidc-sso/domain/user-management";
import type {
	ProvisioningStore,
	ProvisioningTx,
} from "@dokploy/server/oidc-sso/identity/provisioning";
import { createOpenIdClient } from "@dokploy/server/oidc-sso/oidc/client";
import type { SsoEndpointDeps } from "@dokploy/server/oidc-sso/plugin/endpoints";
import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import type { StoredConfig } from "@dokploy/server/oidc-sso/types";
import {
	getUserManagementStatus,
	type UserManagementGuardDeps,
} from "@dokploy/server/oidc-sso/user-management/guard";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright-core";
import { activeConfig, fakeEvents, memoryRepository } from "../helpers";
import type { ModuleConfig, TestUser } from "./types";

/**
 * Must match the redirect URI registered at every provider. Not 3000: that
 * port is often taken by a local Dokploy, and a request reaching it would
 * test the wrong instance.
 */
export const DOKPLOY_PORT = 39000;
export const DOKPLOY_BASE = `http://localhost:${DOKPLOY_PORT}`;
const OWNER_ID = "owner-id";
const OWNER_EMAIL = "owner@dokploy.test";

type Row = Record<string, unknown>;

/**
 * Provisioning over the same in-memory tables better-auth uses, so the users
 * the flow creates exist when the session is issued.
 */
const memoryProvisioning = (tables: { user: Row[] }) => {
	const roles = new Map<string, string>([[OWNER_ID, "owner"]]);
	const subs = new Map<string, string>();
	const idTokens = new Map<string, string>();
	const loginStates = new Map<string, LoginState>();
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
		async upsertSsoAccount({ userId, sub, idToken }) {
			subs.set(sub, userId);
			idTokens.set(userId, idToken);
		},
		async ensureMembership({ userId, role }) {
			if (roles.get(userId) === "owner") return;
			roles.set(userId, role ?? roles.get(userId) ?? "member");
		},
		async recordLoginState({ userId, groups, at }) {
			loginStates.set(userId, { groups, lastSsoLoginAt: at });
		},
	};
	const store: ProvisioningStore = {
		findOwner: async () => ({ userId: OWNER_ID, organizationId: "org" }),
		findUserBySub: async (sub) => {
			const id = subs.get(sub);
			return id && tables.user.some((u) => u.id === id)
				? { id, banned: false }
				: null;
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
	const userIdOf = (email: string) =>
		tables.user.find((u) => u.email === email.toLowerCase())?.id as
			| string
			| undefined;
	return { store, roles, idTokens, loginStates, userIdOf };
};

/** A Dokploy page, not an /api/auth hop that is still redirecting. */
const isDokployPage = (url: URL) =>
	url.origin === DOKPLOY_BASE && !url.pathname.startsWith("/api/auth/");

export interface SignInResult {
	/** Path and query Dokploy sent the browser to at the end of the flow. */
	landing: string;
	role: string | undefined;
	userId: string | undefined;
}

export interface SignOutResult {
	/** The URL /oidc/sign-out told the browser to open. */
	target: string;
	/** HTTP status of the page the target led to. */
	providerStatus: number;
	/** Where the browser ended after following it. */
	finalUrl: string;
	sessionEnded: boolean;
}

/**
 * Dokploy runs in process: the real better-auth handler with oidcSso(),
 * behind a plain HTTP server on loopback. page.route cannot be used, because
 * Playwright does not route requests that arrive through a network redirect,
 * and every provider sends the browser back with one (research R3).
 */
export const createHarness = async (
	moduleConfig: ModuleConfig,
	options: { ignoreHTTPSErrors?: boolean } = {},
) => {
	const repository = memoryRepository({ ...activeConfig, ...moduleConfig });
	const events = fakeEvents();
	const now = new Date();
	const tables = {
		user: [
			{
				id: OWNER_ID,
				email: OWNER_EMAIL,
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
	const provisioning = memoryProvisioning(tables);
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
			instanceOwnerId: async () => OWNER_ID,
			emergencyOrigin: null,
		},
		provisioningStore: provisioning.store,
		findIdToken: async (userId) => provisioning.idTokens.get(userId) ?? null,
		findOwnerEmail: async () => OWNER_EMAIL,
	};
	const auth = betterAuth({
		baseURL: DOKPLOY_BASE,
		secret: "provider-e2e-secret-that-is-long-enough",
		database: memoryAdapter(tables),
		rateLimit: { enabled: false },
		logger: { disabled: true },
		plugins: [oidcSso({ resolveDeps: () => deps })],
	});
	const guardDeps: UserManagementGuardDeps = {
		services: deps.services,
		loginState: {
			find: async (userId) => provisioning.loginStates.get(userId) ?? null,
		},
		resolveTarget: async (ref) => ref.userId ?? null,
	};

	const authHandler = toNodeHandler(auth);
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", DOKPLOY_BASE);
		if (url.pathname.startsWith("/api/auth/")) {
			void authHandler(request, response);
			return;
		}
		// Any other Dokploy page: a stub, so the browser has somewhere to land.
		response.writeHead(200, { "content-type": "text/html" });
		response.end(`<html><body>dokploy ${url.pathname}</body></html>`);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(DOKPLOY_PORT, "127.0.0.1", resolve);
	});

	const browser: Browser = await chromium.launch();
	let context: BrowserContext | null = null;
	let page: Page | null = null;

	const newPage = async () => {
		await context?.close();
		context = await browser.newContext({
			ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false,
		});
		const next = await context.newPage();
		page = next;
		return next;
	};

	const pathOf = (url: string) => {
		const parsed = new URL(url);
		return `${parsed.pathname}${parsed.search}`;
	};

	return {
		deps,
		repository,
		events: events.recorded,
		provisioning,

		async setMode(mode: StoredConfig["mode"], verifiedIssuer?: string) {
			await repository.save(
				verifiedIssuer ? { mode, verifiedIssuer } : { mode },
			);
			deps.services.config.invalidate();
		},

		/** A fresh browser context per sign-in, so no provider session leaks between users. */
		async signIn(
			login: (page: Page, user: TestUser) => Promise<void>,
			user: TestUser,
		): Promise<SignInResult> {
			const current = await newPage();
			await current.goto(
				`${DOKPLOY_BASE}/api/auth/oidc/sign-in?returnTo=${encodeURIComponent("/dashboard/projects")}`,
			);
			if (!current.url().startsWith(DOKPLOY_BASE)) await login(current, user);
			await current.waitForURL(isDokployPage, { timeout: 60_000 });
			const userId = provisioning.userIdOf(user.email);
			return {
				landing: pathOf(current.url()),
				role: userId ? provisioning.roles.get(userId) : undefined,
				userId,
			};
		},

		async signOut(): Promise<SignOutResult> {
			if (!page) throw new Error("signOut() needs a signed-in page");
			const current = page;
			const countSessions = () => tables.session.length;
			const before = countSessions();
			const target = await current.evaluate(async () => {
				const response = await fetch("/api/auth/oidc/sign-out", {
					method: "POST",
					credentials: "include",
				});
				const body = (await response.json()) as { url?: string };
				return body.url ?? "";
			});
			const response = await current.goto(
				new URL(target, DOKPLOY_BASE).toString(),
			);
			// Some providers (Authentik) end on their own "logged out" page
			// instead of sending the browser back; both are a provider logout.
			if (!current.url().startsWith(DOKPLOY_BASE)) {
				await current
					.waitForURL(isDokployPage, { timeout: 10_000 })
					.catch(() => {});
			}
			return {
				target,
				providerStatus: response?.status() ?? 0,
				finalUrl: current.url(),
				sessionEnded: countSessions() < before,
			};
		},

		testConnection(clientSecret: string) {
			return deps.services.oidc.testConnection({
				issuerUrl: moduleConfig.issuerUrl,
				clientId: moduleConfig.clientId,
				clientSecret,
				allowInsecureHttp: moduleConfig.allowInsecureHttp,
			});
		},

		userManagementStatus(userId: string) {
			return getUserManagementStatus(guardDeps, userId);
		},

		async close() {
			await context?.close();
			await browser.close();
			await new Promise((resolve) => server.close(resolve));
		},
	};
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;
