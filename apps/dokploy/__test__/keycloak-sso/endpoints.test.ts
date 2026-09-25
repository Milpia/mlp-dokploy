import { TX_COOKIE } from "@dokploy/server/keycloak-sso/plugin/endpoints";
import { keycloakSso } from "@dokploy/server/keycloak-sso/plugin/index";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { activeConfig, ISSUER, makeDeps } from "./helpers";

const BASE = "http://localhost:3000";

const setup = (options: Parameters<typeof makeDeps>[0] = {}) => {
	const built = makeDeps(options);
	const now = new Date();
	const memory = {
		user: [
			{
				id: "new-user-id",
				email: "dev@example.com",
				name: "Dev",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		],
		session: [] as Record<string, unknown>[],
		account: [] as Record<string, unknown>[],
		verification: [] as Record<string, unknown>[],
	};
	const auth = betterAuth({
		baseURL: BASE,
		secret: "test-secret-that-is-long-enough-for-better-auth",
		database: memoryAdapter(memory),
		rateLimit: { enabled: false },
		plugins: [keycloakSso({ resolveDeps: () => built.deps })],
	});
	return { ...built, auth, memory };
};

const cookiesFrom = (response: Response) =>
	response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");

const findCookie = (response: Response, name: string) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith(`${name}=`));

const signIn = (auth: ReturnType<typeof setup>["auth"], query = "") =>
	auth.handler(new Request(`${BASE}/api/auth/keycloak/sign-in${query}`));

describe("GET /keycloak/sign-in", () => {
	it("NFR-SEC-001: redirects to Keycloak with a sealed, short-lived tx cookie", async () => {
		const { auth } = setup();
		const response = await signIn(auth, "?returnTo=/dashboard/projects");
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain(ISSUER);

		const cookie = findCookie(response, TX_COOKIE) ?? "";
		expect(cookie).toMatch(/HttpOnly/i);
		expect(cookie).toMatch(/SameSite=Lax/i);
		expect(cookie).toMatch(/Max-Age=600/i);
		expect(cookie).toMatch(/Path=\/api\/auth\/keycloak/i);
		// The PKCE verifier must not be readable in the cookie.
		expect(cookie).not.toContain("pkce-verifier-plaintext-marker");
	});

	it("FR-002: returns 404 when the feature is disabled", async () => {
		const { auth, oidc } = setup({
			config: { ...activeConfig, mode: "disabled" },
		});
		const response = await signIn(auth);
		expect(response.status).toBe(404);
		expect(oidc.createAuthorizationRequest).not.toHaveBeenCalled();
	});

	it("FR-016: redirects to the login page with an error when Keycloak is down", async () => {
		const { auth, oidc } = setup();
		oidc.createAuthorizationRequest.mockRejectedValueOnce(
			new TypeError("fetch failed"),
		);
		const response = await signIn(auth);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toMatch(
			/^\/\?error=keycloak_unavailable&ref=[0-9A-F]{12}$/,
		);
	});
});

describe("GET /keycloak/callback", () => {
	const callback = async (
		ctx: ReturnType<typeof setup>,
		query = "code=abc&state=st",
	) => {
		const start = await signIn(ctx.auth, "?returnTo=/dashboard/projects");
		return ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/callback?${query}`, {
				headers: { cookie: cookiesFrom(start).join("; ") },
			}),
		);
	};

	it("FR-005/NFR-SEC-005: creates a session and lands on the requested page", async () => {
		const ctx = setup();
		const response = await callback(ctx);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/dashboard/projects");

		const session = findCookie(response, "better-auth.session_token") ?? "";
		expect(session).toMatch(/HttpOnly/i);
		expect(ctx.memory.session).toHaveLength(1);
		expect(ctx.memory.session[0]?.userId).toBe("new-user-id");
	});

	it("clears the transaction cookie so it cannot be replayed", async () => {
		const ctx = setup();
		const response = await callback(ctx);
		expect(findCookie(response, TX_COOKIE)).toMatch(/Max-Age=0/i);
	});

	it("passes the exact callback query to the token exchange", async () => {
		const ctx = setup();
		await callback(ctx, "code=abc&state=st&session_state=xyz");
		const input = ctx.oidc.exchangeCode.mock.calls[0]?.[1];
		expect(input?.callbackUrl.searchParams.get("code")).toBe("abc");
		expect(input?.callbackUrl.searchParams.get("session_state")).toBe("xyz");
		expect(input).toMatchObject({
			state: "st",
			nonce: "no",
			codeVerifier: "pkce-verifier-plaintext-marker",
			redirectUri: `${BASE}/api/auth/keycloak/callback`,
		});
	});

	it("NFR-SEC-001: without the tx cookie the login fails closed", async () => {
		const ctx = setup();
		const response = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/callback?code=abc&state=st`),
		);
		expect(response.headers.get("location")).toMatch(
			/^\/\?error=keycloak_invalid_response/,
		);
		expect(ctx.oidc.exchangeCode).not.toHaveBeenCalled();
		expect(ctx.memory.session).toHaveLength(0);
	});

	it("NFR-SEC-001: a tampered tx cookie is rejected", async () => {
		const ctx = setup();
		const response = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/callback?code=abc&state=st`, {
				headers: { cookie: `${TX_COOKIE}=forged.value.here` },
			}),
		);
		expect(response.headers.get("location")).toMatch(
			/error=keycloak_invalid_response/,
		);
	});

	it("FR-007: an access denial creates no session", async () => {
		const ctx = setup();
		ctx.oidc.exchangeCode.mockResolvedValueOnce({
			claims: { sub: "x", email: "o@e.com", email_verified: true, groups: [] },
			idToken: "t",
		});
		const response = await callback(ctx);
		expect(response.headers.get("location")).toMatch(
			/error=keycloak_access_denied/,
		);
		expect(ctx.memory.session).toHaveLength(0);
	});

	it("FR-002: returns 404 when the feature is disabled", async () => {
		const ctx = setup({ config: { ...activeConfig, mode: "disabled" } });
		const response = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/callback?code=abc`),
		);
		expect(response.status).toBe(404);
	});
});

describe("POST /keycloak/sign-out (FR-010)", () => {
	const signedInCookie = async (ctx: ReturnType<typeof setup>) => {
		const start = await signIn(ctx.auth);
		const done = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/callback?code=abc&state=st`, {
				headers: { cookie: cookiesFrom(start).join("; ") },
			}),
		);
		return cookiesFrom(done)
			.filter((c) => c.startsWith("better-auth.session_token="))
			.join("; ");
	};

	const signOut = (ctx: ReturnType<typeof setup>, cookie: string) =>
		ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/sign-out`, {
				method: "POST",
				headers: { cookie, origin: BASE },
			}),
		);

	it("button mode deletes the Dokploy session and returns /", async () => {
		const ctx = setup();
		const cookie = await signedInCookie(ctx);
		expect(ctx.memory.session).toHaveLength(1);
		const response = await signOut(ctx, cookie);
		expect(await response.json()).toEqual({ url: "/" });
		expect(ctx.memory.session).toHaveLength(0);
	});

	it("sso-only mode returns the Keycloak end-session URL with the id token hint", async () => {
		const ctx = setup({
			config: { ...activeConfig, mode: "sso-only", verifiedIssuer: ISSUER },
			idToken: "stored-id-token",
		});
		const cookie = await signedInCookie(ctx);
		const response = await signOut(ctx, cookie);
		const body = (await response.json()) as { url: string };
		expect(body.url).toContain("/protocol/openid-connect/logout");
		expect(ctx.oidc.buildEndSessionUrl).toHaveBeenCalledWith(
			expect.anything(),
			{ idTokenHint: "stored-id-token", postLogoutRedirectUri: `${BASE}/` },
		);
		expect(ctx.memory.session).toHaveLength(0);
	});

	it("works without a session", async () => {
		const ctx = setup();
		const response = await signOut(ctx, "");
		expect(await response.json()).toEqual({ url: "/" });
	});

	it("is not reachable with GET (no cross-site logout)", async () => {
		const ctx = setup();
		const response = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/keycloak/sign-out`),
		);
		expect(response.status).not.toBe(200);
	});
});
