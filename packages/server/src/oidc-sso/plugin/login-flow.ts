import { extractIdentity, type SsoIdentity } from "../domain/claims";
import { sanitizeReturnTo } from "../domain/return-to";
import { parseScopes } from "../domain/scopes";
import { newCorrelationId } from "../events/auth-events";
import type {
	ProvisioningStore,
	ProvisionResult,
} from "../identity/provisioning";
import { provisionIdentity } from "../identity/provisioning";
import { mapOidcError, type OidcSettings } from "../oidc/client";
import type { OidcSsoServices } from "../services";
import type { DenyReason, EffectiveConfig, LoginErrorCode } from "../types";

export const SIGNED_OUT_PATH = "/?signed_out=1";

export interface LoginFlowDeps {
	services: OidcSsoServices;
	provisioningStore: ProvisioningStore;
}

export interface LoginTransaction {
	state: string;
	nonce: string;
	codeVerifier: string;
	returnTo: string;
}

export type LoginFailure = {
	ok: false;
	code: LoginErrorCode;
	correlationId: string;
};

export const toOidcSettings = (config: EffectiveConfig): OidcSettings => ({
	issuerUrl: config.issuerUrl ?? "",
	clientId: config.clientId ?? "",
	clientSecret: config.clientSecret ?? "",
	allowInsecureHttp: config.allowInsecureHttp,
});

const denialCode = (reason: DenyReason): LoginErrorCode =>
	reason === "email_missing" || reason === "email_unverified"
		? "sso_email_unverified"
		: "sso_access_denied";

const logFailure = (correlationId: string, stage: string, error: unknown) => {
	// Only the error class and message: tokens and codes must never reach logs.
	const detail =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	console.error(`OIDC SSO [${correlationId}] ${stage} failed: ${detail}`);
};

export const startLogin = async (
	{ services }: LoginFlowDeps,
	{ returnTo, redirectUri }: { returnTo: unknown; redirectUri: string },
): Promise<{ ok: true; url: string; tx: LoginTransaction } | LoginFailure> => {
	const config = await services.config.getEffective();
	try {
		const request = await services.oidc.createAuthorizationRequest(
			toOidcSettings(config),
			redirectUri,
			parseScopes(config.extraScopes) ?? [],
		);
		return {
			ok: true,
			url: request.url,
			tx: {
				state: request.state,
				nonce: request.nonce,
				codeVerifier: request.codeVerifier,
				returnTo: sanitizeReturnTo(returnTo),
			},
		};
	} catch (error) {
		const correlationId = newCorrelationId();
		logFailure(correlationId, "authorization request", error);
		const code = mapOidcError(error);
		await services.events.record({
			type: "sso_login",
			outcome: "error",
			reason: code,
			correlationId,
		});
		return { ok: false, code, correlationId };
	}
};

export interface CompleteLoginInput {
	tx: LoginTransaction | null;
	callbackUrl: URL;
	redirectUri: string;
	ip?: string;
}

export type CompleteLoginResult =
	| { ok: true; userId: string; returnTo: string; correlationId: string }
	| LoginFailure;

export const completeLogin = async (
	{ services, provisioningStore }: LoginFlowDeps,
	{ tx, callbackUrl, redirectUri, ip }: CompleteLoginInput,
): Promise<CompleteLoginResult> => {
	const correlationId = newCorrelationId();
	const fail = async (
		code: LoginErrorCode,
		outcome: "denied" | "error",
		reason: string,
		identity?: SsoIdentity,
	): Promise<LoginFailure> => {
		await services.events.record({
			type: "sso_login",
			outcome,
			reason,
			correlationId,
			...(identity?.email ? { email: identity.email } : {}),
			...(ip ? { ip } : {}),
		});
		return { ok: false, code, correlationId };
	};

	const providerError = callbackUrl.searchParams.get("error");
	if (providerError) {
		const code =
			providerError === "access_denied" || providerError === "login_required"
				? "sso_cancelled"
				: "sso_invalid_response";
		return fail(code, "denied", `provider_${providerError}`);
	}
	if (!tx) {
		return fail("sso_invalid_response", "error", "missing_transaction");
	}

	const config = await services.config.getEffective();
	let identity: SsoIdentity;
	let idToken: string;
	try {
		const result = await services.oidc.exchangeCode(toOidcSettings(config), {
			callbackUrl,
			redirectUri,
			state: tx.state,
			nonce: tx.nonce,
			codeVerifier: tx.codeVerifier,
			groupsClaim: config.groupsClaim,
		});
		identity = extractIdentity(result.claims, config.groupsClaim);
		idToken = result.idToken;
	} catch (error) {
		logFailure(correlationId, "code exchange", error);
		const code = mapOidcError(error);
		return fail(code, "error", code);
	}

	let provisioned: ProvisionResult;
	try {
		provisioned = await provisionIdentity({
			store: provisioningStore,
			identity,
			idToken,
			accessGroup: config.accessGroup,
			adminGroup: config.adminGroup,
		});
	} catch (error) {
		logFailure(correlationId, "provisioning", error);
		return fail("sso_unavailable", "error", "provisioning_failed", identity);
	}
	if (!provisioned.allow) {
		return fail(
			denialCode(provisioned.reason),
			"denied",
			provisioned.reason,
			identity,
		);
	}

	if (
		provisioned.isOwner &&
		config.issuerUrl &&
		config.verifiedIssuer !== config.issuerUrl
	) {
		await services.config.markVerified(config.issuerUrl);
	}

	await services.events.record({
		type: "sso_login",
		outcome: "success",
		reason: provisioned.action,
		correlationId,
		userId: provisioned.userId,
		...(identity.email ? { email: identity.email } : {}),
		...(ip ? { ip } : {}),
	});
	return {
		ok: true,
		userId: provisioned.userId,
		returnTo: tx.returnTo,
		correlationId,
	};
};

/**
 * Only sso-only mode ends the identity provider session too; otherwise the user would
 * be signed straight back in by the automatic redirect (FR-010).
 */
export const resolveSignOutTarget = async (
	{ services }: LoginFlowDeps,
	{ idToken, origin }: { idToken?: string; origin: string },
): Promise<string> => {
	const config = await services.config.getEffective();
	if (!config.active || config.mode !== "sso-only") return "/";
	const url = await services.oidc.buildEndSessionUrl(toOidcSettings(config), {
		...(idToken ? { idTokenHint: idToken } : {}),
		postLogoutRedirectUri: `${origin}/`,
	});
	// Without provider logout (e.g. Authelia), "/" would bounce straight back
	// into a silent sign-in; the signed-out screen waits for the user (FR-025).
	return url ?? SIGNED_OUT_PATH;
};
