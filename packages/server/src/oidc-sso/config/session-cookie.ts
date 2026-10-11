type Env = Record<string, string | undefined>;

/**
 * NFR-SEC-005: the session cookie is `Secure` when the instance is served
 * over https. Without a base URL, or with a plain http one (local installs),
 * it stays as upstream sets it.
 */
export const sessionCookieSecure = (env: Env = process.env): boolean => {
	try {
		return new URL(env.BETTER_AUTH_URL ?? "").protocol === "https:";
	} catch {
		return false;
	}
};
