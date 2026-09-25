export interface SsoIdentity {
	sub: string;
	email?: string;
	emailVerified: boolean;
	givenName?: string;
	familyName?: string;
	groups: string[];
}

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

export const DEFAULT_GROUPS_CLAIM = "groups";

/**
 * Providers disagree on the shape: a list (Keycloak, Okta, Authentik,
 * Authelia), a single string, or an object keyed by role name (Zitadel's
 * urn:zitadel:iam:org:project:roles).
 */
const readGroups = (value: unknown): string[] => {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (Array.isArray(value)) {
		return value.filter((group): group is string => typeof group === "string");
	}
	if (value && typeof value === "object") return Object.keys(value);
	return [];
};

export const extractIdentity = (
	claims: Record<string, unknown>,
	groupsClaim: string = DEFAULT_GROUPS_CLAIM,
): SsoIdentity => {
	const sub = optionalString(claims.sub);
	if (!sub) {
		throw new Error("ID token has no subject");
	}
	const email = optionalString(claims.email)?.toLowerCase();
	const groups = readGroups(claims[groupsClaim]);

	return {
		sub,
		...(email ? { email } : {}),
		emailVerified: claims.email_verified === true,
		...(optionalString(claims.given_name)
			? { givenName: optionalString(claims.given_name) }
			: {}),
		...(optionalString(claims.family_name)
			? { familyName: optionalString(claims.family_name) }
			: {}),
		groups,
	};
};

export const normalizeGroup = (group: string): string =>
	group.trim().replace(/^\/+|\/+$/g, "");

/**
 * Keycloak's Group Membership mapper emits either full paths
 * ("/teams/dokploy-users") or bare names depending on its "Full group path"
 * switch. A configured bare name matches either form; a configured path must
 * match the full path exactly.
 */
const matchesGroup = (groups: string[], configured: string): boolean => {
	const target = normalizeGroup(configured);
	if (!target) return false;
	const targetIsPath = target.includes("/");

	return groups.some((group) => {
		const normalized = normalizeGroup(group);
		if (!normalized) return false;
		if (normalized === target) return true;
		return !targetIsPath && normalized.split("/").at(-1) === target;
	});
};

/** `configured` may list several groups separated by commas (any matches). */
export const isInGroup = (groups: string[], configured: string): boolean =>
	configured.split(",").some((entry) => matchesGroup(groups, entry));
