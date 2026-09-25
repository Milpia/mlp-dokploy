export const KEYCLOAK_SIGN_IN_PATH = "/api/auth/keycloak/sign-in";
const KEYCLOAK_SIGN_OUT_PATH = "/api/auth/keycloak/sign-out";

export const keycloakSignInUrl = (returnTo?: string) =>
	returnTo
		? `${KEYCLOAK_SIGN_IN_PATH}?${new URLSearchParams({ returnTo })}`
		: KEYCLOAK_SIGN_IN_PATH;

/**
 * Ends the Dokploy session and returns where the browser must go next: the
 * Keycloak end-session page in SSO-only mode (FR-010), otherwise "/".
 */
export const signOutWithKeycloak = async (): Promise<string> => {
	const response = await fetch(KEYCLOAK_SIGN_OUT_PATH, {
		method: "POST",
		credentials: "include",
	});
	if (!response.ok) return "/";
	const body = (await response.json()) as { url?: unknown };
	return typeof body.url === "string" ? body.url : "/";
};
