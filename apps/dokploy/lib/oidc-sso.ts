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
