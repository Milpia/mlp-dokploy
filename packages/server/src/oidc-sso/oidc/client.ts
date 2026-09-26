import { createHash } from "node:crypto";
import * as openid from "openid-client";
import { authorizationScopes } from "../domain/scopes";
import { type LoginErrorCode, SsoLoginError } from "../types";

export interface OidcSettings {
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	allowInsecureHttp: boolean;
}

export interface AuthorizationRequest {
	url: string;
	state: string;
	nonce: string;
	codeVerifier: string;
}

export interface CodeExchangeInput {
	/** The full callback URL as received, including `code` and `state`. */
	callbackUrl: URL;
	redirectUri: string;
	state: string;
	nonce: string;
	codeVerifier: string;
	/** Claim holding groups or roles; defaults to "groups". */
	groupsClaim?: string;
}

export interface CodeExchangeResult {
	claims: Record<string, unknown>;
	idToken: string;
}

export type TestFailure =
	| "invalid_url"
	| "insecure_http"
	| "unreachable"
	| "timeout"
	| "not_oidc"
	| "issuer_mismatch"
	| "invalid_client";

export type TestResult =
	| { ok: true; issuer: string }
	| { ok: false; code: TestFailure; message: string };

export interface OidcClient {
	createAuthorizationRequest(
		settings: OidcSettings,
		redirectUri: string,
		extraScopes?: string[],
	): Promise<AuthorizationRequest>;
	exchangeCode(
		settings: OidcSettings,
		input: CodeExchangeInput,
	): Promise<CodeExchangeResult>;
	buildEndSessionUrl(
		settings: OidcSettings,
		params: { idTokenHint?: string; postLogoutRedirectUri: string },
	): Promise<string | null>;
	testConnection(settings: OidcSettings): Promise<TestResult>;
	/** Forget cached discovery documents and keys (after a config change). */
	reset(): void;
}

type OpenIdLib = Pick<
	typeof openid,
	| "discovery"
	| "buildAuthorizationUrl"
	| "authorizationCodeGrant"
	| "buildEndSessionUrl"
	| "fetchUserInfo"
	| "genericGrantRequest"
	| "tokenRevocation"
	| "randomPKCECodeVerifier"
	| "calculatePKCECodeChallenge"
	| "randomState"
	| "randomNonce"
	| "allowInsecureRequests"
	| "ClientSecretPost"
>;

/**
 * A failed client check, or null when the refusal came after the client was
 * authenticated (invalid_grant, unsupported_token_type...), which means the
 * credentials are valid.
 */
const credentialFailure = (error: unknown): TestResult | null => {
	const oauthError = (error as { error?: string }).error;
	const status = (error as { status?: number }).status;
	if (
		oauthError === "invalid_client" ||
		oauthError === "unauthorized_client" ||
		status === 401
	) {
		return {
			ok: false,
			code: "invalid_client",
			message: "The identity provider rejected the client ID or secret.",
		};
	}
	const network = isNetworkFailure(error);
	if (network) {
		return {
			ok: false,
			code: network,
			message:
				"The identity provider stopped answering while checking the client.",
		};
	}
	return null;
};

const REQUEST_TIMEOUT_SECONDS = 5;
const CONNECTION_TEST_CODE = "dokploy-connection-test";
const CONNECTION_TEST_REDIRECT_URI =
	"https://dokploy.invalid/api/auth/oidc/callback";
const CLOCK_TOLERANCE_SECONDS = 30;

const errorChain = (error: unknown): unknown[] => {
	const chain: unknown[] = [];
	let current = error;
	while (current && chain.length < 5) {
		chain.push(current);
		current = (current as { cause?: unknown }).cause;
	}
	return chain;
};

const isNetworkFailure = (error: unknown): "timeout" | "unreachable" | null => {
	for (const item of errorChain(error)) {
		const name = (item as { name?: string }).name;
		const code = (item as { code?: string }).code;
		if (name === "TimeoutError" || name === "AbortError") return "timeout";
		if (
			(item instanceof TypeError && /fetch failed/i.test(item.message)) ||
			code === "ECONNREFUSED" ||
			code === "ENOTFOUND" ||
			code === "EAI_AGAIN" ||
			code === "ECONNRESET" ||
			code === "CERT_HAS_EXPIRED" ||
			code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
			code === "DEPTH_ZERO_SELF_SIGNED_CERT"
		) {
			return "unreachable";
		}
	}
	return null;
};

/**
 * Collapses library and network errors into the stable codes shown to users
 * (contracts/http-endpoints.md). Unknown errors map to invalid_response so the
 * login fails closed.
 */
export const mapOidcError = (error: unknown): LoginErrorCode => {
	if (error instanceof SsoLoginError) return error.code;
	if (isNetworkFailure(error)) return "sso_unavailable";

	for (const item of errorChain(error)) {
		const code = (item as { code?: string }).code;
		const oauthError = (item as { error?: string }).error;
		if (code === "OAUTH_JWT_TIMESTAMP_CHECK_FAILED") {
			return "sso_clock_skew";
		}
		if (code === "OAUTH_AUTHORIZATION_RESPONSE_ERROR") {
			return oauthError === "access_denied" ||
				oauthError === "login_required" ||
				oauthError === "consent_required"
				? "sso_cancelled"
				: "sso_invalid_response";
		}
		if (
			code === "OAUTH_RESPONSE_BODY_ERROR" &&
			oauthError === "invalid_client"
		) {
			return "sso_unavailable";
		}
		if (
			code === "OAUTH_RESPONSE_IS_NOT_JSON" ||
			code === "OAUTH_INVALID_SERVER_METADATA"
		) {
			return "sso_unavailable";
		}
	}
	return "sso_invalid_response";
};

const fingerprint = (settings: OidcSettings): string =>
	createHash("sha256")
		.update(
			JSON.stringify([
				settings.issuerUrl,
				settings.clientId,
				settings.clientSecret,
				settings.allowInsecureHttp,
			]),
		)
		.digest("hex");

const assertTransportAllowed = (settings: OidcSettings): URL => {
	let url: URL;
	try {
		url = new URL(settings.issuerUrl);
	} catch (cause) {
		throw new SsoLoginError("sso_unavailable", "The issuer URL is not valid", {
			cause,
		});
	}
	if (url.protocol === "http:" && !settings.allowInsecureHttp) {
		throw new SsoLoginError(
			"sso_unavailable",
			"Plain HTTP to the identity provider is not allowed unless explicitly enabled",
		);
	}
	return url;
};

export const createOpenIdClient = (lib: OpenIdLib = openid): OidcClient => {
	const configurations = new Map<string, Promise<openid.Configuration>>();

	const discover = (settings: OidcSettings): Promise<openid.Configuration> => {
		const key = fingerprint(settings);
		const cached = configurations.get(key);
		if (cached) return cached;

		const issuer = assertTransportAllowed(settings);
		const pending = lib
			.discovery(
				issuer,
				settings.clientId,
				undefined,
				lib.ClientSecretPost(settings.clientSecret),
				{
					timeout: REQUEST_TIMEOUT_SECONDS,
					...(settings.allowInsecureHttp && issuer.protocol === "http:"
						? { execute: [lib.allowInsecureRequests] }
						: {}),
				},
			)
			.then((config) => {
				(config as unknown as Record<symbol, number>)[openid.clockTolerance] =
					CLOCK_TOLERANCE_SECONDS;
				return config;
			});
		// Only one configuration is ever live; old fingerprints are dropped so
		// a rotated secret does not linger in memory.
		configurations.clear();
		configurations.set(key, pending);
		pending.catch(() => {
			if (configurations.get(key) === pending) configurations.delete(key);
		});
		return pending;
	};

	return {
		async createAuthorizationRequest(settings, redirectUri, extraScopes = []) {
			const config = await discover(settings);
			const codeVerifier = lib.randomPKCECodeVerifier();
			const state = lib.randomState();
			const nonce = lib.randomNonce();
			const url = lib.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				response_type: "code",
				scope: authorizationScopes(extraScopes),
				code_challenge: await lib.calculatePKCECodeChallenge(codeVerifier),
				code_challenge_method: "S256",
				state,
				nonce,
			});
			return { url: url.href, state, nonce, codeVerifier };
		},

		async exchangeCode(settings, input) {
			const config = await discover(settings);
			const tokens = await lib.authorizationCodeGrant(
				config,
				input.callbackUrl,
				{
					pkceCodeVerifier: input.codeVerifier,
					expectedState: input.state,
					expectedNonce: input.nonce,
					idTokenExpected: true,
				},
				{ redirect_uri: input.redirectUri },
			);
			const idTokenClaims = tokens.claims();
			if (!tokens.id_token || !idTokenClaims) {
				throw new SsoLoginError(
					"sso_invalid_response",
					"The identity provider did not return an ID token",
				);
			}
			const claims: Record<string, unknown> = { ...idTokenClaims };

			// Some providers only expose groups through userinfo (e.g. Keycloak
			// with the mapper's "Add to ID token" switch off).
			const groupsClaim = input.groupsClaim ?? "groups";
			if (claims[groupsClaim] === undefined && tokens.access_token) {
				const userInfo = await lib.fetchUserInfo(
					config,
					tokens.access_token,
					idTokenClaims.sub,
				);
				if (userInfo[groupsClaim] !== undefined) {
					claims[groupsClaim] = userInfo[groupsClaim];
				}
			}
			return { claims, idToken: tokens.id_token };
		},

		async buildEndSessionUrl(settings, params) {
			try {
				const config = await discover(settings);
				if (!config.serverMetadata().end_session_endpoint) return null;
				return lib.buildEndSessionUrl(config, {
					client_id: settings.clientId,
					post_logout_redirect_uri: params.postLogoutRedirectUri,
					...(params.idTokenHint ? { id_token_hint: params.idTokenHint } : {}),
				}).href;
			} catch {
				return null;
			}
		},

		async testConnection(settings) {
			let issuer: URL;
			try {
				issuer = new URL(settings.issuerUrl);
			} catch {
				return {
					ok: false,
					code: "invalid_url",
					message: "The issuer URL is not a valid URL.",
				};
			}
			if (issuer.protocol === "http:" && !settings.allowInsecureHttp) {
				return {
					ok: false,
					code: "insecure_http",
					message:
						"The issuer uses plain HTTP. Use HTTPS, or enable insecure HTTP for development only.",
				};
			}

			let config: openid.Configuration;
			try {
				configurations.clear();
				config = await discover(settings);
			} catch (error) {
				const network = isNetworkFailure(error);
				if (network === "timeout") {
					return {
						ok: false,
						code: "timeout",
						message: "The identity provider did not answer within 5 seconds.",
					};
				}
				if (network === "unreachable") {
					return {
						ok: false,
						code: "unreachable",
						message:
							"The identity provider could not be reached. Check the URL, DNS and TLS certificate.",
					};
				}
				const text = String((error as Error)?.message ?? "");
				if (/issuer/i.test(text)) {
					return {
						ok: false,
						code: "issuer_mismatch",
						message:
							"The discovery document announces a different issuer. Use the exact issuer URL (for Keycloak: https://keycloak.example.com/realms/<realm>).",
					};
				}
				return {
					ok: false,
					code: "not_oidc",
					message:
						"No valid OpenID Connect discovery document was found at this URL.",
				};
			}

			// Revoking a made-up token (RFC 7009 §2.1) needs client authentication
			// and changes nothing, so when the provider offers it, it decides.
			// The code test below is only a fallback: some providers look at the
			// code before the client and pass a wrong secret, and others reject
			// its unregistered redirect URI as invalid_client (spec 004 FR-011).
			if (config.serverMetadata().revocation_endpoint) {
				try {
					await lib.tokenRevocation(config, CONNECTION_TEST_CODE);
				} catch (error) {
					const failure = credentialFailure(error);
					if (failure) return failure;
				}
				return { ok: true, issuer: config.serverMetadata().issuer };
			}
			// A made-up authorization code: RFC 6749 §4.1.3 has the server
			// authenticate the client before looking at the code, so bad
			// credentials fail as invalid_client (Keycloak: unauthorized_client,
			// 401) while good ones reach invalid_grant. client_credentials cannot
			// tell them apart when service accounts are disabled.
			try {
				await lib.genericGrantRequest(config, "authorization_code", {
					code: CONNECTION_TEST_CODE,
					redirect_uri: CONNECTION_TEST_REDIRECT_URI,
				});
			} catch (error) {
				const failure = credentialFailure(error);
				if (failure) return failure;
			}
			return { ok: true, issuer: config.serverMetadata().issuer };
		},

		reset() {
			configurations.clear();
		},
	};
};
