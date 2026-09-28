import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "@dokploy/server/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type {
	EnvironmentFilter,
	GroupProfile,
	ReadOnlyEnvironments,
	ReadOnlyScope,
} from "../types";

export interface ScopeCatalog {
	projectsByName(
		organizationId: string,
		names: string[],
	): Promise<Array<{ projectId: string; name: string }>>;
	environmentsOf(
		projectIds: string[],
	): Promise<Array<{ environmentId: string; projectId: string; name: string }>>;
	servicesOf(environmentIds: string[]): Promise<string[]>;
}

export interface ScopePart {
	projects: string[];
	environments?: EnvironmentFilter;
	readOnly?: ReadOnlyEnvironments;
}

export interface ResolvedScope {
	projectIds: string[];
	environmentIds: string[];
	serviceIds: string[];
	readOnly: ReadOnlyScope;
}

const NO_READ_ONLY: ReadOnlyScope = {
	environmentIds: [],
	serviceIds: [],
	projectIds: [],
};

export interface GroupProfileCheck {
	group: string;
	missingProjects: string[];
	ambiguousProjects: string[];
	projectsResolved: number;
	/** Read-only names that match no environment of the group's projects (spec 006, R8). */
	missingReadOnlyEnvironments: string[];
}

const keeps = (filter: EnvironmentFilter | undefined, name: string) => {
	if (!filter) return true;
	return "include" in filter
		? filter.include.includes(name)
		: !filter.exclude.includes(name);
};

const isReadOnly = (readOnly: ReadOnlyEnvironments | undefined, name: string) =>
	readOnly === true || (readOnly?.includes(name) ?? false);

/**
 * Turns the names of each group's scope into the ids upstream checks
 * (spec 005, research R5). Project names are not unique upstream, so every
 * match is included; a project left without environments is left out.
 *
 * Read-only environments stay in the upstream scope so members can see them;
 * an environment is read-only only if no group grants it with full access
 * (spec 006, FR-007).
 */
export const resolveScope = async (
	parts: ScopePart[],
	organizationId: string,
	catalog: ScopeCatalog,
): Promise<ResolvedScope> => {
	const names = [...new Set(parts.flatMap((part) => part.projects))];
	if (names.length === 0) {
		return {
			projectIds: [],
			environmentIds: [],
			serviceIds: [],
			readOnly: NO_READ_ONLY,
		};
	}
	const found = await catalog.projectsByName(organizationId, names);
	const envs = await catalog.environmentsOf(found.map((p) => p.projectId));

	const environmentIds = new Set<string>();
	const readOnlyIds = new Set<string>();
	const fullIds = new Set<string>();
	for (const part of parts) {
		const partProjects = new Set(
			found
				.filter((p) => part.projects.includes(p.name))
				.map((p) => p.projectId),
		);
		for (const env of envs) {
			if (
				partProjects.has(env.projectId) &&
				keeps(part.environments, env.name)
			) {
				environmentIds.add(env.environmentId);
				(isReadOnly(part.readOnly, env.name) ? readOnlyIds : fullIds).add(
					env.environmentId,
				);
			}
		}
	}

	const projectIds = new Set(
		envs
			.filter((env) => environmentIds.has(env.environmentId))
			.map((env) => env.projectId),
	);
	const serviceIds =
		environmentIds.size === 0
			? []
			: await catalog.servicesOf([...environmentIds]);

	const readOnlyEnvironmentIds = [...readOnlyIds].filter(
		(id) => !fullIds.has(id),
	);
	const readOnlyServiceIds =
		readOnlyEnvironmentIds.length === 0
			? []
			: await catalog.servicesOf(readOnlyEnvironmentIds);
	const readOnlyProjectIds = new Set(
		envs
			.filter((env) => readOnlyEnvironmentIds.includes(env.environmentId))
			.map((env) => env.projectId),
	);

	return {
		projectIds: [...projectIds],
		environmentIds: [...environmentIds],
		serviceIds: [...new Set(serviceIds)],
		readOnly: {
			environmentIds: readOnlyEnvironmentIds,
			serviceIds: [...new Set(readOnlyServiceIds)],
			projectIds: [...readOnlyProjectIds],
		},
	};
};

/** What the SSO screen shows under the profiles field (spec 005, R5). */
export const checkGroupProfiles = async (
	profiles: GroupProfile[],
	organizationId: string,
	catalog: ScopeCatalog,
): Promise<GroupProfileCheck[]> => {
	const names = [...new Set(profiles.flatMap((profile) => profile.projects))];
	const found =
		names.length === 0
			? []
			: await catalog.projectsByName(organizationId, names);
	const needsEnvironments = profiles.some((profile) =>
		Array.isArray(profile.readOnly),
	);
	const envs =
		needsEnvironments && found.length > 0
			? await catalog.environmentsOf(found.map((p) => p.projectId))
			: [];
	return profiles.map((profile) => {
		const counts = profile.projects.map(
			(name) => [name, found.filter((p) => p.name === name).length] as const,
		);
		const projectIds = new Set(
			found
				.filter((p) => profile.projects.includes(p.name))
				.map((p) => p.projectId),
		);
		const envNames = new Set(
			envs
				.filter((env) => projectIds.has(env.projectId))
				.map((env) => env.name),
		);
		return {
			group: profile.group,
			missingProjects: counts.filter(([, n]) => n === 0).map(([name]) => name),
			ambiguousProjects: counts.filter(([, n]) => n > 1).map(([name]) => name),
			projectsResolved: counts.reduce((sum, [, n]) => sum + n, 0),
			missingReadOnlyEnvironments: Array.isArray(profile.readOnly)
				? profile.readOnly.filter((name) => !envNames.has(name))
				: [],
		};
	});
};

const SERVICE_TABLES = [
	[applications, applications.applicationId, applications.environmentId],
	[compose, compose.composeId, compose.environmentId],
	[postgres, postgres.postgresId, postgres.environmentId],
	[mysql, mysql.mysqlId, mysql.environmentId],
	[mariadb, mariadb.mariadbId, mariadb.environmentId],
	[mongo, mongo.mongoId, mongo.environmentId],
	[redis, redis.redisId, redis.environmentId],
	[libsql, libsql.libsqlId, libsql.environmentId],
] as const;

export const drizzleScopeCatalog: ScopeCatalog = {
	projectsByName(organizationId, names) {
		return db
			.select({ projectId: projects.projectId, name: projects.name })
			.from(projects)
			.where(
				and(
					eq(projects.organizationId, organizationId),
					inArray(projects.name, names),
				),
			);
	},

	async environmentsOf(projectIds) {
		if (projectIds.length === 0) return [];
		return db
			.select({
				environmentId: environments.environmentId,
				projectId: environments.projectId,
				name: environments.name,
			})
			.from(environments)
			.where(inArray(environments.projectId, projectIds));
	},

	async servicesOf(environmentIds) {
		const rows = await Promise.all(
			SERVICE_TABLES.map(([table, id, environmentId]) =>
				db
					.select({ id })
					.from(table)
					.where(inArray(environmentId, environmentIds)),
			),
		);
		return rows.flat().map((row) => row.id);
	},
};
