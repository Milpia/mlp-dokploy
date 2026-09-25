export interface KeycloakIdentity {
	sub: string;
	email?: string;
	emailVerified: boolean;
	givenName?: string;
	familyName?: string;
	groups: string[];
}

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

export const extractIdentity = (
	claims: Record<string, unknown>,
): KeycloakIdentity => {
	const sub = optionalString(claims.sub);
	if (!sub) {
		throw new Error("ID token has no subject");
	}
	const email = optionalString(claims.email)?.toLowerCase();
	const groups = Array.isArray(claims.groups)
		? claims.groups.filter(
				(group): group is string => typeof group === "string",
			)
		: [];

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
export const isInGroup = (groups: string[], configured: string): boolean => {
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
