const BASE_SCOPES = ["openid", "email", "profile"];

// RFC 6749 §3.3: scope-token = 1*( %x21 / %x23-5B / %x5D-7E )
const SCOPE_TOKEN = /^[!#-[\]-~]+$/;

/** Space-separated scopes to a deduplicated list, or null if any is invalid. */
export const parseScopes = (value: string): string[] | null => {
	const tokens = value.split(/\s+/).filter(Boolean);
	if (tokens.some((token) => !SCOPE_TOKEN.test(token))) return null;
	return [...new Set(tokens)];
};

export const authorizationScopes = (extra: string[]): string =>
	[...new Set([...BASE_SCOPES, ...extra])].join(" ");
