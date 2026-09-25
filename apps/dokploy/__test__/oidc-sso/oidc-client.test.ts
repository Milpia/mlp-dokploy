import {
	createOpenIdClient,
	mapOidcError,
	type OidcSettings,
} from "@dokploy/server/oidc-sso/oidc/client";
import { SsoLoginError } from "@dokploy/server/oidc-sso/types";
import { describe, expect, it, vi } from "vitest";

const settings: OidcSettings = {
	issuerUrl: "https://kc.example.com/realms/milpia",
	clientId: "dokploy",
	clientSecret: "secret",
	allowInsecureHttp: false,
};

const fakeConfig = (metadata: Record<string, unknown> = {}) => ({
	serverMetadata: () => ({
		issuer: settings.issuerUrl,
		end_session_endpoint: `${settings.issuerUrl}/protocol/openid-connect/logout`,
		...metadata,
	}),
});

const fakeLib = (overrides: Record<string, unknown> = {}) => {
	const lib = {
		discovery: vi.fn(async (..._args: unknown[]) => fakeConfig()),
		buildAuthorizationUrl: vi.fn(
			(_config: unknown, params: Record<string, string>) =>
				new URL(
					`https://kc.example.com/auth?${new URLSearchParams(params).toString()}`,
				),
		),
		authorizationCodeGrant: vi.fn(async () => ({
			id_token: "id.token.value",
			access_token: "access",
			claims: () => ({ sub: "sub-1", email: "a@b.c", groups: ["/g"] }),
		})),
		buildEndSessionUrl: vi.fn(
			(_config: unknown, params: Record<string, string>) =>
				new URL(
					`https://kc.example.com/logout?${new URLSearchParams(params).toString()}`,
				),
		),
		fetchUserInfo: vi.fn(async () => ({ sub: "sub-1", groups: ["/from-ui"] })),
		genericGrantRequest: vi.fn(async () => {
			throw Object.assign(new Error("x"), {
				error: "invalid_grant",
				status: 400,
			});
		}),
		randomPKCECodeVerifier: vi.fn(() => "verifier"),
		calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
		randomState: vi.fn(() => "state"),
		randomNonce: vi.fn(() => "nonce"),
		allowInsecureRequests: vi.fn(),
		ClientSecretPost: vi.fn(() => "client-auth"),
		...overrides,
	};
	return lib;
};

const timeoutError = () =>
	Object.assign(new Error("The operation was aborted due to timeout"), {
		name: "TimeoutError",
	});

describe("mapOidcError", () => {
	it("keeps codes from SsoLoginError", () => {
		expect(mapOidcError(new SsoLoginError("sso_clock_skew", "x"))).toBe(
			"sso_clock_skew",
		);
	});

	it("NFR-PERF-004: maps timeouts and network failures to unavailable", () => {
		expect(mapOidcError(timeoutError())).toBe("sso_unavailable");
		expect(mapOidcError(new TypeError("fetch failed"))).toBe("sso_unavailable");
		expect(
			mapOidcError(
				new TypeError("x", {
					cause: Object.assign(new Error("c"), { code: "ECONNREFUSED" }),
				}),
			),
		).toBe("sso_unavailable");
	});

	it("maps a user cancellation to cancelled", () => {
		const error = Object.assign(new Error("denied"), {
			code: "OAUTH_AUTHORIZATION_RESPONSE_ERROR",
			error: "access_denied",
		});
		expect(mapOidcError(error)).toBe("sso_cancelled");
	});

	it("maps other authorization errors to invalid_response", () => {
		const error = Object.assign(new Error("bad"), {
			code: "OAUTH_AUTHORIZATION_RESPONSE_ERROR",
			error: "invalid_scope",
		});
		expect(mapOidcError(error)).toBe("sso_invalid_response");
	});

	it("maps a failed timestamp check to clock_skew", () => {
		expect(
			mapOidcError(
				Object.assign(new Error("exp"), {
					code: "OAUTH_JWT_TIMESTAMP_CHECK_FAILED",
				}),
			),
		).toBe("sso_clock_skew");
	});

	it("NFR-SEC-002: state, nonce and signature failures are invalid responses", () => {
		for (const code of [
			"OAUTH_INVALID_RESPONSE",
			"OAUTH_JWT_CLAIM_COMPARISON_FAILED",
			"OAUTH_KEY_SELECTION_FAILED",
		]) {
			expect(mapOidcError(Object.assign(new Error(code), { code }))).toBe(
				"sso_invalid_response",
			);
		}
		expect(mapOidcError("weird")).toBe("sso_invalid_response");
	});

	it("maps a rejected client to unavailable (misconfiguration)", () => {
		expect(
			mapOidcError(
				Object.assign(new Error("x"), {
					code: "OAUTH_RESPONSE_BODY_ERROR",
					error: "invalid_client",
				}),
			),
		).toBe("sso_unavailable");
		expect(
			mapOidcError(
				Object.assign(new Error("x"), { code: "OAUTH_RESPONSE_IS_NOT_JSON" }),
			),
		).toBe("sso_unavailable");
	});
});

describe("createOpenIdClient", () => {
	it("NFR-SEC-001: builds a PKCE S256 request with state and nonce", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		const request = await client.createAuthorizationRequest(
			settings,
			"https://dokploy.example.com/api/auth/oidc/callback",
		);
		expect(request).toMatchObject({
			state: "state",
			nonce: "nonce",
			codeVerifier: "verifier",
		});
		const params = new URL(request.url).searchParams;
		expect(params.get("code_challenge")).toBe("challenge");
		expect(params.get("code_challenge_method")).toBe("S256");
		expect(params.get("response_type")).toBe("code");
		expect(params.get("scope")).toBe("openid email profile");
		expect(params.get("redirect_uri")).toBe(
			"https://dokploy.example.com/api/auth/oidc/callback",
		);
	});

	it("FR-023a: appends extra scopes to openid email profile without duplicates", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		const request = await client.createAuthorizationRequest(
			settings,
			"https://x/cb",
			["groups", "email", "urn:zitadel:iam:org:projects:roles"],
		);
		expect(new URL(request.url).searchParams.get("scope")).toBe(
			"openid email profile groups urn:zitadel:iam:org:projects:roles",
		);
	});

	it("NFR-PERF-003/004: discovers once per configuration with a 5 s timeout", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		await client.createAuthorizationRequest(settings, "https://x/cb");
		await client.createAuthorizationRequest(settings, "https://x/cb");
		expect(lib.discovery).toHaveBeenCalledTimes(1);
		expect(lib.discovery.mock.calls[0]?.[4]).toMatchObject({ timeout: 5 });

		await client.createAuthorizationRequest(
			{ ...settings, clientSecret: "rotated" },
			"https://x/cb",
		);
		expect(lib.discovery).toHaveBeenCalledTimes(2);
	});

	it("retries discovery after a failure instead of caching it", async () => {
		const lib = fakeLib();
		lib.discovery.mockRejectedValueOnce(timeoutError());
		const client = createOpenIdClient(lib as never);
		await expect(
			client.createAuthorizationRequest(settings, "https://x/cb"),
		).rejects.toThrow();
		await expect(
			client.createAuthorizationRequest(settings, "https://x/cb"),
		).resolves.toBeDefined();
		expect(lib.discovery).toHaveBeenCalledTimes(2);
	});

	it("NFR-SEC-004: refuses plain HTTP unless explicitly allowed", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		const http = { ...settings, issuerUrl: "http://kc.local/realms/dev" };
		await expect(
			client.createAuthorizationRequest(http, "https://x/cb"),
		).rejects.toBeInstanceOf(SsoLoginError);
		expect(lib.discovery).not.toHaveBeenCalled();

		await client.createAuthorizationRequest(
			{ ...http, allowInsecureHttp: true },
			"https://x/cb",
		);
		expect(lib.discovery.mock.calls[0]?.[4]).toMatchObject({
			execute: [lib.allowInsecureRequests],
		});
	});

	it("NFR-SEC-002: exchanges the code with every check enabled", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		const result = await client.exchangeCode(settings, {
			callbackUrl: new URL("https://x/cb?code=c&state=state"),
			redirectUri: "https://x/cb",
			state: "state",
			nonce: "nonce",
			codeVerifier: "verifier",
		});
		expect(lib.authorizationCodeGrant).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(URL),
			{
				pkceCodeVerifier: "verifier",
				expectedState: "state",
				expectedNonce: "nonce",
				idTokenExpected: true,
			},
			{ redirect_uri: "https://x/cb" },
		);
		expect(result).toEqual({
			claims: { sub: "sub-1", email: "a@b.c", groups: ["/g"] },
			idToken: "id.token.value",
		});
		expect(lib.fetchUserInfo).not.toHaveBeenCalled();
	});

	it("FR-023: the userinfo fallback uses the configured claim name", async () => {
		const claim = "urn:zitadel:iam:org:project:roles";
		const lib = fakeLib({
			authorizationCodeGrant: vi.fn(async () => ({
				id_token: "t",
				access_token: "access",
				claims: () => ({ sub: "sub-1" }),
			})),
			fetchUserInfo: vi.fn(async () => ({
				sub: "sub-1",
				[claim]: { "dokploy-users": {} },
			})),
		});
		const client = createOpenIdClient(lib as never);
		const result = await client.exchangeCode(settings, {
			callbackUrl: new URL("https://x/cb?code=c"),
			redirectUri: "https://x/cb",
			state: "s",
			nonce: "n",
			codeVerifier: "v",
			groupsClaim: claim,
		});
		expect(result.claims[claim]).toEqual({ "dokploy-users": {} });
	});

	it("falls back to userinfo when the ID token carries no groups", async () => {
		const lib = fakeLib({
			authorizationCodeGrant: vi.fn(async () => ({
				id_token: "t",
				access_token: "access",
				claims: () => ({ sub: "sub-1" }),
			})),
		});
		const client = createOpenIdClient(lib as never);
		const result = await client.exchangeCode(settings, {
			callbackUrl: new URL("https://x/cb?code=c"),
			redirectUri: "https://x/cb",
			state: "s",
			nonce: "n",
			codeVerifier: "v",
		});
		expect(lib.fetchUserInfo).toHaveBeenCalledWith(
			expect.anything(),
			"access",
			"sub-1",
		);
		expect(result.claims.groups).toEqual(["/from-ui"]);
	});

	it("fails closed when no ID token is returned", async () => {
		const lib = fakeLib({
			authorizationCodeGrant: vi.fn(async () => ({
				access_token: "a",
				claims: () => undefined,
			})),
		});
		const client = createOpenIdClient(lib as never);
		await expect(
			client.exchangeCode(settings, {
				callbackUrl: new URL("https://x/cb"),
				redirectUri: "https://x/cb",
				state: "s",
				nonce: "n",
				codeVerifier: "v",
			}),
		).rejects.toMatchObject({ code: "sso_invalid_response" });
	});

	it("FR-010: builds the end-session URL with the hint and client id", async () => {
		const client = createOpenIdClient(fakeLib() as never);
		const url = await client.buildEndSessionUrl(settings, {
			idTokenHint: "hint",
			postLogoutRedirectUri: "https://dokploy.example.com/",
		});
		const params = new URL(url as string).searchParams;
		expect(params.get("id_token_hint")).toBe("hint");
		expect(params.get("client_id")).toBe("dokploy");
		expect(params.get("post_logout_redirect_uri")).toBe(
			"https://dokploy.example.com/",
		);
	});

	it("returns null when the provider has no end-session endpoint or is down", async () => {
		const noEndpoint = createOpenIdClient(
			fakeLib({
				discovery: vi.fn(async () =>
					fakeConfig({ end_session_endpoint: undefined }),
				),
			}) as never,
		);
		await expect(
			noEndpoint.buildEndSessionUrl(settings, { postLogoutRedirectUri: "/" }),
		).resolves.toBeNull();

		const down = createOpenIdClient(
			fakeLib({
				discovery: vi.fn(async () => {
					throw timeoutError();
				}),
			}) as never,
		);
		await expect(
			down.buildEndSessionUrl(settings, { postLogoutRedirectUri: "/" }),
		).resolves.toBeNull();
	});
});

describe("testConnection (FR-014)", () => {
	it("succeeds with discovery and accepted credentials", async () => {
		const client = createOpenIdClient(fakeLib() as never);
		await expect(client.testConnection(settings)).resolves.toEqual({
			ok: true,
			issuer: settings.issuerUrl,
		});
	});

	it("treats invalid_grant on the made-up code as valid credentials", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		await expect(client.testConnection(settings)).resolves.toMatchObject({
			ok: true,
		});
		expect(lib.genericGrantRequest).toHaveBeenCalledWith(
			expect.anything(),
			"authorization_code",
			expect.objectContaining({ code: "dokploy-connection-test" }),
		);
	});

	it("reports Keycloak's unauthorized_client (401) as invalid_client", async () => {
		const client = createOpenIdClient(
			fakeLib({
				genericGrantRequest: vi.fn(async () => {
					throw Object.assign(new Error("x"), {
						error: "unauthorized_client",
						status: 401,
					});
				}),
			}) as never,
		);
		await expect(client.testConnection(settings)).resolves.toMatchObject({
			ok: false,
			code: "invalid_client",
		});
	});

	it.each([
		["invalid_url", { ...settings, issuerUrl: "not a url" }, {}],
		[
			"insecure_http",
			{ ...settings, issuerUrl: "http://kc.local/realms/x" },
			{},
		],
		[
			"timeout",
			settings,
			{
				discovery: vi.fn(async () => {
					throw timeoutError();
				}),
			},
		],
		[
			"unreachable",
			settings,
			{
				discovery: vi.fn(async () => {
					throw new TypeError("fetch failed");
				}),
			},
		],
		[
			"issuer_mismatch",
			settings,
			{
				discovery: vi.fn(async () => {
					throw new Error('"response" body "issuer" property does not match');
				}),
			},
		],
		[
			"not_oidc",
			settings,
			{
				discovery: vi.fn(async () => {
					throw new Error("unexpected HTTP response status code");
				}),
			},
		],
		[
			"invalid_client",
			settings,
			{
				genericGrantRequest: vi.fn(async () => {
					throw Object.assign(new Error("x"), { error: "invalid_client" });
				}),
			},
		],
		[
			"timeout",
			settings,
			{
				genericGrantRequest: vi.fn(async () => {
					throw timeoutError();
				}),
			},
		],
	])("reports %s", async (code, testSettings, overrides) => {
		const client = createOpenIdClient(fakeLib(overrides) as never);
		await expect(client.testConnection(testSettings)).resolves.toMatchObject({
			ok: false,
			code,
		});
	});

	it("reset() forces a new discovery", async () => {
		const lib = fakeLib();
		const client = createOpenIdClient(lib as never);
		await client.createAuthorizationRequest(settings, "https://x/cb");
		client.reset();
		await client.createAuthorizationRequest(settings, "https://x/cb");
		expect(lib.discovery).toHaveBeenCalledTimes(2);
	});
});
