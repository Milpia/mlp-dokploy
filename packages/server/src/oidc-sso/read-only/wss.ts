import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	deployments,
	libsql,
	mariadb,
	member,
	mongo,
	mysql,
	postgres,
	redis,
} from "@dokploy/server/db/schema";
import { getRemoteDocker } from "@dokploy/server/utils/servers/remote-docker";
import { and, eq } from "drizzle-orm";
import { type AuthEventInput, newCorrelationId } from "../events/auth-events";
import { memberProfileCache, type ReadOnlySets } from "../member-profile/cache";
import {
	checkMemberProfileExpiryForUser,
	defaultMemberProfileExpiryDeps,
	type ExpiryResult,
	type MemberProfileExpiryDeps,
} from "../member-profile/expiry";
import {
	getReadOnlyScope,
	isReadOnlyEmpty,
} from "../member-profile/read-only-scope";
import { drizzleMemberProfileStore } from "../member-profile/store";
import { TERMINAL_INSPECT_TIMEOUT_MS } from "../types";
import { drizzleSubResourceOwner } from "./lookup";

export interface ContainerBindingDeps {
	isProfiled(userId: string): boolean;
	findRole(userId: string, organizationId: string): Promise<string | null>;
	getScope(userId: string): Promise<ReadOnlySets>;
	appNameOf(serviceId: string): Promise<string | null>;
	labelsOf(
		containerId: string,
		serverId: string | null,
	): Promise<Record<string, string>>;
	record(event: AuthEventInput): Promise<void>;
	timeoutMs: number;
}

export interface ContainerRequest {
	userId: string;
	organizationId: string;
	serviceId: string | null;
	containerId: string;
	serverId: string | null;
	mode: "terminal" | "logs";
}

export type WssCheckResult =
	| { ok: true }
	| {
			ok: false;
			reason:
				| "read_only"
				| "container_mismatch"
				| "out_of_scope"
				| "profile_expired"
				| "read_only_check_failed";
	  };

const SERVICE_TABLES = [
	[applications, applications.applicationId, applications.appName],
	[compose, compose.composeId, compose.appName],
	[postgres, postgres.postgresId, postgres.appName],
	[mysql, mysql.mysqlId, mysql.appName],
	[mariadb, mariadb.mariadbId, mariadb.appName],
	[mongo, mongo.mongoId, mongo.appName],
	[redis, redis.redisId, redis.appName],
	[libsql, libsql.libsqlId, libsql.appName],
] as const;

const appNameOf = async (serviceId: string) => {
	for (const [table, id, appName] of SERVICE_TABLES) {
		const [row] = await db
			.select({ appName })
			.from(table)
			.where(eq(id, serviceId))
			.limit(1);
		if (row) return row.appName;
	}
	return null;
};

const labelsOf = async (containerId: string, serverId: string | null) => {
	const client = await getRemoteDocker(serverId);
	const info = await client.getContainer(containerId).inspect();
	return info.Config?.Labels ?? {};
};

export const defaultContainerBindingDeps = (services: {
	events: { record(event: AuthEventInput): Promise<void> };
}): ContainerBindingDeps => ({
	isProfiled: (userId) => memberProfileCache.has(userId),
	findRole: (userId, organizationId) =>
		drizzleMemberProfileStore().findRole(userId, organizationId),
	getScope: (userId) => getReadOnlyScope(userId),
	appNameOf,
	labelsOf,
	record: (event) => services.events.record(event),
	timeoutMs: TERMINAL_INSPECT_TIMEOUT_MS,
});

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${ms} ms`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});

// Apps and databases run as the swarm service named after appName; a compose
// runs either as a stack with that namespace or as a compose project.
const belongsTo = (labels: Record<string, string>, appName: string) =>
	labels["com.docker.swarm.service.name"] === appName ||
	labels["com.docker.stack.namespace"] === appName ||
	labels["com.docker.compose.project"] === appName;

export const wssEvent = (
	userId: string,
	action: string,
	outcome: "denied" | "error",
	reason: string,
	resourceId?: string | null,
): AuthEventInput => ({
	type: "member_profile",
	outcome,
	reason,
	correlationId: newCorrelationId(),
	userId,
	action,
	...(resourceId ? { resourceId } : {}),
});

/**
 * Runs after canAccessDockerOverWss, whose expiry check reloads the profile
 * cache when it is stale, so `isProfiled` is current here.
 *
 * A profiled member may only open the terminal or logs of a container that
 * belongs to the service the connection names (spec 006, FR-004b), and never
 * the terminal of a read-only service (FR-004). Owners, admins and members
 * without a profile keep upstream's behaviour, with no query.
 */
export const checkContainerBinding = async (
	request: ContainerRequest,
	deps: ContainerBindingDeps,
): Promise<WssCheckResult> => {
	const { userId, serviceId, mode } = request;
	const action = `wss:docker-container-${mode}`;
	if (!deps.isProfiled(userId)) return { ok: true };
	try {
		if ((await deps.findRole(userId, request.organizationId)) !== "member") {
			return { ok: true };
		}
		const deny = async (
			reason: "read_only" | "container_mismatch",
		): Promise<WssCheckResult> => {
			await deps.record(wssEvent(userId, action, "denied", reason, serviceId));
			return { ok: false, reason };
		};
		if (!serviceId) return deny("container_mismatch");
		if (mode === "terminal") {
			const scope = await deps.getScope(userId);
			if (scope.serviceIds.has(serviceId)) return deny("read_only");
		}
		const appName = await deps.appNameOf(serviceId);
		if (!appName) return deny("container_mismatch");
		const labels = await withTimeout(
			deps.labelsOf(request.containerId, request.serverId),
			deps.timeoutMs,
		);
		return belongsTo(labels, appName)
			? { ok: true }
			: deny("container_mismatch");
	} catch (error) {
		console.error("OIDC SSO: container binding check failed", error);
		await deps
			.record(
				wssEvent(userId, action, "error", "read_only_check_failed", serviceId),
			)
			.catch(() => {});
		return { ok: false, reason: "read_only_check_failed" };
	}
};

export interface DeploymentLogDeps {
	isProfiled(userId: string): boolean;
	findRole(userId: string, organizationId: string): Promise<string | null>;
	checkExpiry(userId: string, organizationId: string): Promise<ExpiryResult>;
	serviceOfLog(logPath: string): Promise<string | null>;
	accessedServices(userId: string, organizationId: string): Promise<string[]>;
	record(event: AuthEventInput): Promise<void>;
}

const serviceOfLog = async (logPath: string) => {
	const [row] = await db
		.select({ deploymentId: deployments.deploymentId })
		.from(deployments)
		.where(eq(deployments.logPath, logPath))
		.limit(1);
	return row
		? drizzleSubResourceOwner.ownerOf("deployment", row.deploymentId)
		: null;
};

const accessedServices = async (userId: string, organizationId: string) => {
	const [row] = await db
		.select({ services: member.accessedServices })
		.from(member)
		.where(
			and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
		)
		.limit(1);
	return row?.services ?? [];
};

export const defaultDeploymentLogDeps = (
	services: MemberProfileExpiryDeps["services"],
): DeploymentLogDeps => ({
	isProfiled: (userId) => memberProfileCache.has(userId),
	findRole: (userId, organizationId) =>
		drizzleMemberProfileStore().findRole(userId, organizationId),
	checkExpiry: (userId, organizationId) =>
		checkMemberProfileExpiryForUser(
			userId,
			organizationId,
			defaultMemberProfileExpiryDeps(services),
		),
	serviceOfLog,
	accessedServices,
	record: (event) => services.events.record(event),
});

/**
 * For a profiled member the deployment must belong to a service of their
 * scope and the profile must not have expired (spec 006, FR-004c).
 * The expiry check runs first because it reloads the profile cache.
 */
export const checkDeploymentLogAccess = async (
	request: { userId: string; organizationId: string; logPath: string },
	deps: DeploymentLogDeps,
): Promise<WssCheckResult> => {
	const { userId, organizationId, logPath } = request;
	const action = "wss:listen-deployment";
	try {
		const expiry = await deps.checkExpiry(userId, organizationId);
		if (!expiry.ok) return { ok: false, reason: "read_only_check_failed" };
		if (expiry.outcome === "expired") {
			return { ok: false, reason: "profile_expired" };
		}
		if (!deps.isProfiled(userId)) return { ok: true };
		if ((await deps.findRole(userId, organizationId)) !== "member") {
			return { ok: true };
		}
		const serviceId = await deps.serviceOfLog(logPath);
		const scope = await deps.accessedServices(userId, organizationId);
		if (serviceId && scope.includes(serviceId)) return { ok: true };
		await deps.record(
			wssEvent(userId, action, "denied", "out_of_scope", serviceId),
		);
		return { ok: false, reason: "out_of_scope" };
	} catch (error) {
		console.error("OIDC SSO: deployment log check failed", error);
		await deps
			.record(wssEvent(userId, action, "error", "read_only_check_failed"))
			.catch(() => {});
		return { ok: false, reason: "read_only_check_failed" };
	}
};

export interface ServerTerminalDeps {
	isProfiled(userId: string): boolean;
	findRole(userId: string, organizationId: string): Promise<string | null>;
	checkExpiry(userId: string, organizationId: string): Promise<ExpiryResult>;
	getScope(userId: string): Promise<ReadOnlySets>;
	record(event: AuthEventInput): Promise<void>;
}

export const defaultServerTerminalDeps = (
	services: MemberProfileExpiryDeps["services"],
): ServerTerminalDeps => ({
	...defaultDeploymentLogDeps(services),
	getScope: (userId) => getReadOnlyScope(userId),
});

/**
 * A server shell reaches every environment that runs on the server, so it is
 * refused to anyone with a read-only environment (spec 006, FR-004a). The 005
 * expiry check was missing here too, and runs first because it reloads the
 * profile cache.
 */
export const checkServerTerminal = async (
	request: { userId: string; organizationId: string },
	deps: ServerTerminalDeps,
): Promise<WssCheckResult> => {
	const { userId, organizationId } = request;
	const action = "wss:terminal";
	try {
		const expiry = await deps.checkExpiry(userId, organizationId);
		if (!expiry.ok) return { ok: false, reason: "read_only_check_failed" };
		if (!deps.isProfiled(userId)) return { ok: true };
		if ((await deps.findRole(userId, organizationId)) !== "member") {
			return { ok: true };
		}
		const scope = await deps.getScope(userId);
		if (isReadOnlyEmpty(scope)) return { ok: true };
		await deps.record(wssEvent(userId, action, "denied", "read_only"));
		return { ok: false, reason: "read_only" };
	} catch (error) {
		console.error("OIDC SSO: server terminal check failed", error);
		await deps
			.record(wssEvent(userId, action, "error", "read_only_check_failed"))
			.catch(() => {});
		return { ok: false, reason: "read_only_check_failed" };
	}
};
