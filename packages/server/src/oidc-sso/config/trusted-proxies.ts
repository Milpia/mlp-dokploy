type Env = Record<string, string | undefined>;

/**
 * `SSO_OIDC_TRUSTED_PROXIES`: comma-separated IPs or CIDR ranges of the
 * proxies that extend X-Forwarded-For in front of Dokploy (in production, the
 * Cloudflare ranges). better-auth walks that header from the right, skips
 * these and keys its rate limits on the first address left. Without them it
 * only accepts a single-address header, so a header a proxy extended falls
 * into one bucket shared by every client. better-auth warns about and ignores
 * entries that are not an IP or a CIDR range.
 */
export const readTrustedProxies = (env: Env = process.env): string[] =>
	(env.SSO_OIDC_TRUSTED_PROXIES ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

/** The `advanced` fields for betterAuth; empty without the variable. */
export const trustedProxiesAdvanced = (env: Env = process.env) => {
	const trustedProxies = readTrustedProxies(env);
	return trustedProxies.length > 0 ? { ipAddress: { trustedProxies } } : {};
};
