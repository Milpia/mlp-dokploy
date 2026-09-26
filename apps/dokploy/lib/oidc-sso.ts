import type { LoginErrorCode } from "@dokploy/server/oidc-sso/types";

export const SSO_SIGN_IN_PATH = "/api/auth/oidc/sign-in";
const SSO_SIGN_OUT_PATH = "/api/auth/oidc/sign-out";

export const ssoSignInUrl = (returnTo?: string) =>
	returnTo
		? `${SSO_SIGN_IN_PATH}?${new URLSearchParams({ returnTo })}`
		: SSO_SIGN_IN_PATH;

/**
 * Ends the Dokploy session and returns where the browser must go next: the
 * identity provider's end-session page in SSO-only mode (FR-010), otherwise "/".
 */
export const signOutWithSso = async (): Promise<string> => {
	const response = await fetch(SSO_SIGN_OUT_PATH, {
		method: "POST",
		credentials: "include",
	});
	if (!response.ok) return "/";
	const body = (await response.json()) as { url?: unknown };
	return typeof body.url === "string" ? body.url : "/";
};

/** Login screen texts per error code (spec 001 NFR-QA-004, NFR-SEC-006). */
export const SSO_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
	sso_cancelled: "Single sign-on was cancelled.",
	sso_invalid_response:
		"We couldn't verify the response from the identity provider. Please try again.",
	sso_email_unverified:
		"Your identity provider account has no verified email address. Ask your administrator to verify it.",
	sso_access_denied:
		"Your identity provider account doesn't have access to this Dokploy instance. Ask your administrator to add you to the access group.",
	// Must not say that a Dokploy account exists for this email (NFR-SEC-006):
	// the reference leads the administrator to the identity_conflict event.
	sso_identity_mismatch:
		"We couldn't match your identity provider account with this Dokploy instance. Ask your administrator to check your account with this reference.",
	sso_unavailable:
		"The identity provider is not available right now. Please try again in a few minutes.",
	sso_clock_skew:
		"The sign-in response from the identity provider has an invalid timestamp. Ask your administrator to check that the server clocks are synchronized.",
};
