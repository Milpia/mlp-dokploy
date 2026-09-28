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
import type { EnvironmentFilter, GroupProfile } from "../types";

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
}

export interface ResolvedScope {
	projectIds: string[];
	environmentIds: string[];
	serviceIds: string[];
}

export interface GroupProfileCheck {
	group: string;
	missingProjects: string[];
	ambiguousProjects: string[];
	projectsResolved: number;
}

const keeps = (filter: EnvironmentFilter | undefined, name: string) => {
	if (!filter) return true;
	return "include" in filter
		? filter.include.includes(name)
		: !filter.exclude.includes(name);
};

/**
 * Turns the names of each group's scope into the ids upstream checks
 * (spec 005, research R5). Project names are not unique upstream, so every
 * match is included; a project left without environments is left out.
 */
export const resolveScope = async (
	parts: ScopePart[],
	organizationId: string,
	catalog: ScopeCatalog,
): Promise<ResolvedScope> => {
	const names = [...new Set(parts.flatMap((part) => part.projects))];
	if (names.length === 0) {
		return { projectIds: [], environmentIds: [], serviceIds: [] };
	}
	const found = await catalog.projectsByName(organizationId, names);
	const envs = await catalog.environmentsOf(found.map((p) => p.projectId));

	const environmentIds = new Set<string>();
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

	return {
		projectIds: [...projectIds],
		environmentIds: [...environmentIds],
		serviceIds: [...new Set(serviceIds)],
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
	return profiles.map((profile) => {
		const counts = profile.projects.map(
			(name) => [name, found.filter((p) => p.name === name).length] as const,
		);
		return {
			group: profile.group,
			missingProjects: counts.filter(([, n]) => n === 0).map(([name]) => name),
			ambiguousProjects: counts.filter(([, n]) => n > 1).map(([name]) => name),
			projectsResolved: counts.reduce((sum, [, n]) => sum + n, 0),
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
