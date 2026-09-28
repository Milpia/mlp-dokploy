import {
	type EnvironmentFilter,
	type GroupProfile,
	MAX_READ_ONLY_ENVIRONMENTS,
	MEMBER_PERMISSIONS,
	type MemberPermission,
	type ReadOnlyEnvironments,
} from "../types";
import { isInGroup } from "./claims";

export const GROUP_PROFILES_MAX_BYTES = 16_384;
const MAX_GROUPS = 20;
const MAX_GROUP_NAME_LENGTH = 256;
const MAX_PROJECTS = 200;
const MAX_ENVIRONMENTS = 20;
const MAX_NAME_LENGTH = 256;

export type GroupProfilesResult =
	| { ok: true; profiles: GroupProfile[] }
	| { ok: false; error: string };

export interface MergedProfile {
	groups: string[];
	permissions: MemberPermission[];
	scopes: Array<{
		projects: string[];
		environments?: EnvironmentFilter;
		readOnly?: ReadOnlyEnvironments;
	}>;
}

class ProfileError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const onlyKeys = (
	value: Record<string, unknown>,
	allowed: string[],
	path: string,
) => {
	const unknown = Object.keys(value).find((key) => !allowed.includes(key));
	if (unknown !== undefined) {
		throw new ProfileError(`${path}: unknown key "${unknown}"`);
	}
};

const nameList = (value: unknown, path: string, max: number): string[] => {
	if (!Array.isArray(value)) {
		throw new ProfileError(`${path}: must be a list of names`);
	}
	if (value.length > max) {
		throw new ProfileError(`${path}: at most ${max} names`);
	}
	return value.map((item, index) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new ProfileError(`${path}[${index}]: must be a non-empty name`);
		}
		if (item.length > MAX_NAME_LENGTH) {
			throw new ProfileError(
				`${path}[${index}]: at most ${MAX_NAME_LENGTH} characters`,
			);
		}
		return item.trim();
	});
};

const parseEnvironments = (
	value: unknown,
	path: string,
): EnvironmentFilter | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new ProfileError(
			`${path}: must be { "include": [...] } or { "exclude": [...] }`,
		);
	}
	onlyKeys(value, ["include", "exclude"], path);
	const hasInclude = "include" in value;
	const hasExclude = "exclude" in value;
	if (hasInclude === hasExclude) {
		throw new ProfileError(
			`${path}: use either "include" or "exclude", not both`,
		);
	}
	return hasInclude
		? { include: nameList(value.include, `${path}.include`, MAX_ENVIRONMENTS) }
		: { exclude: nameList(value.exclude, `${path}.exclude`, MAX_ENVIRONMENTS) };
};

const parsePermissions = (value: unknown, path: string): MemberPermission[] => {
	if (!Array.isArray(value)) {
		throw new ProfileError(`${path}: must be a list of permissions`);
	}
	return [
		...new Set(
			value.map((item, index) => {
				if (!MEMBER_PERMISSIONS.includes(item as MemberPermission)) {
					throw new ProfileError(
						`${path}[${index}]: unknown permission ${JSON.stringify(item)}`,
					);
				}
				return item as MemberPermission;
			}),
		),
	];
};

// Names outside the group's own filter would silently never apply, which for
// a read-only list means an environment the owner meant to protect stays
// writable (spec 006, FR-014).
const parseReadOnly = (
	value: unknown,
	environments: EnvironmentFilter | undefined,
	path: string,
): ReadOnlyEnvironments | undefined => {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	if (!Array.isArray(value) || value.length === 0) {
		throw new ProfileError(
			`${path}: must be true, false or a list of environment names`,
		);
	}
	const names = nameList(value, path, MAX_READ_ONLY_ENVIRONMENTS);
	names.forEach((name, index) => {
		if (names.indexOf(name) !== index) {
			throw new ProfileError(
				`${path}[${index}]: duplicate environment ${JSON.stringify(name)}`,
			);
		}
		if (environments && "exclude" in environments) {
			if (environments.exclude.includes(name)) {
				throw new ProfileError(
					`${path}[${index}]: environment ${JSON.stringify(name)} is excluded from the group scope`,
				);
			}
		} else if (environments && !environments.include.includes(name)) {
			throw new ProfileError(
				`${path}[${index}]: environment ${JSON.stringify(name)} is not in the group include list`,
			);
		}
	});
	return names;
};

const parseProfile = (group: string, value: unknown): GroupProfile => {
	if (!isRecord(value)) {
		throw new ProfileError(`${group}: must be an object`);
	}
	onlyKeys(
		value,
		["permissions", "projects", "environments", "readOnly"],
		group,
	);
	const environments = parseEnvironments(
		value.environments,
		`${group}.environments`,
	);
	const permissions = parsePermissions(
		value.permissions,
		`${group}.permissions`,
	);
	const projects = nameList(value.projects, `${group}.projects`, MAX_PROJECTS);
	const readOnly = parseReadOnly(
		value.readOnly,
		environments,
		`${group}.readOnly`,
	);
	return {
		group,
		permissions,
		projects,
		...(environments ? { environments } : {}),
		...(readOnly ? { readOnly } : {}),
	};
};

const checkGroupName = (group: string) => {
	if (
		group.trim().length === 0 ||
		group.length > MAX_GROUP_NAME_LENGTH ||
		group.includes(",")
	) {
		throw new ProfileError(
			`invalid group name ${JSON.stringify(group)}: 1 to ${MAX_GROUP_NAME_LENGTH} characters, without commas`,
		);
	}
};

/**
 * Validates the whole group profile configuration (spec 005, FR-009). Any
 * error rejects the full set: applying half a configuration could grant or
 * revoke access nobody asked for.
 */
export const parseGroupProfiles = (
	raw: string | null | undefined,
): GroupProfilesResult => {
	if (raw === null || raw === undefined || raw.trim().length === 0) {
		return { ok: true, profiles: [] };
	}
	if (Buffer.byteLength(raw, "utf8") > GROUP_PROFILES_MAX_BYTES) {
		return {
			ok: false,
			error: `group profiles must be at most ${GROUP_PROFILES_MAX_BYTES} bytes`,
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false, error: "group profiles are not valid JSON" };
	}
	try {
		if (!isRecord(value)) {
			throw new ProfileError("group profiles must be an object keyed by group");
		}
		const groups = Object.keys(value);
		if (groups.length > MAX_GROUPS) {
			throw new ProfileError(`at most ${MAX_GROUPS} groups`);
		}
		return {
			ok: true,
			profiles: groups.map((group) => {
				checkGroupName(group);
				return parseProfile(group.trim(), value[group]);
			}),
		};
	} catch (error) {
		if (error instanceof ProfileError) {
			return { ok: false, error: error.message };
		}
		throw error;
	}
};

/**
 * Profiles of the groups a user belongs to, merged (FR-006). Groups match
 * like the access and admin groups, so a bare name also matches a full
 * Keycloak group path. Null means the user is in no profiled group.
 */
export const mergeProfiles = (
	profiles: GroupProfile[],
	userGroups: string[],
): MergedProfile | null => {
	const matched = profiles.filter((profile) =>
		isInGroup(userGroups, profile.group),
	);
	if (matched.length === 0) return null;
	return {
		groups: matched.map((profile) => profile.group),
		permissions: MEMBER_PERMISSIONS.filter((permission) =>
			matched.some((profile) => profile.permissions.includes(permission)),
		),
		scopes: matched.map(({ projects, environments, readOnly }) => ({
			projects,
			...(environments ? { environments } : {}),
			...(readOnly ? { readOnly } : {}),
		})),
	};
};
