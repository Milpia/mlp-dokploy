import type { ReadOnlySets } from "../member-profile/cache";

export type SubResource =
	| "domain"
	| "mount"
	| "port"
	| "redirect"
	| "security"
	| "backup"
	| "volumeBackup"
	| "schedule"
	| "deployment"
	| "rollback"
	| "previewDeployment"
	| "patch";

/**
 * How a mutation reaches an environment (spec 006, research R5). `service`
 * and `secretQuery` take the first key present; a missing id denies.
 */
export type ReadOnlyRule =
	| { kind: "service"; keys: readonly string[] }
	| { kind: "environment"; key: string }
	| { kind: "project"; key: string }
	| { kind: "lookup"; resource: SubResource; key: string }
	| { kind: "unbound" }
	| { kind: "outside" }
	| { kind: "secretQuery"; keys: readonly string[] };

export type ReadOnlyDecision =
	| { allow: true }
	| { allow: false; resourceId?: string }
	| { lookup: SubResource; id: string };

const service = (...keys: string[]): ReadOnlyRule => ({
	kind: "service",
	keys,
});
const environment = (key = "environmentId"): ReadOnlyRule => ({
	kind: "environment",
	key,
});
const lookup = (resource: SubResource, key: string): ReadOnlyRule => ({
	kind: "lookup",
	resource,
	key,
});
const UNBOUND: ReadOnlyRule = { kind: "unbound" };
const OUTSIDE: ReadOnlyRule = { kind: "outside" };

const DATABASE_KEYS = [
	"postgresId",
	"mysqlId",
	"mariadbId",
	"mongoId",
	"libsqlId",
] as const;

const SERVICE_KEYS = [
	"applicationId",
	"composeId",
	...DATABASE_KEYS,
	"redisId",
	"serviceId",
	"databaseId",
];

const ENVIRONMENT_KEYS = [
	"environmentId",
	"targetEnvironmentId",
	"sourceEnvironmentId",
];

const databaseRouter = (router: string, key: string) => ({
	[`${router}.*`]: service(key),
	[`${router}.create`]: environment(),
});

/**
 * Every mutation and subscription of appRouter, by exact path or by
 * `<router>.*`. A path without a rule is denied to anyone with a read-only
 * scope, and the drift test fails until it is classified, so a new upstream
 * procedure never slips through (FR-005). Routers that act on the server or
 * on resources shared by every environment (SSH keys, git providers,
 * registries, backup destinations, DNS, vault) are `unbound`: changing them
 * reaches the read-only environments too.
 */
export const READ_ONLY_POLICY: Readonly<Record<string, ReadOnlyRule>> = {
	"application.*": service("applicationId"),
	"application.create": environment(),
	"application.deployNginxQuickstart": environment(),

	"compose.*": service("composeId"),
	"compose.create": environment(),
	"compose.deployTemplate": environment(),
	"compose.previewTemplate": OUTSIDE,

	...databaseRouter("postgres", "postgresId"),
	...databaseRouter("mysql", "mysqlId"),
	...databaseRouter("mariadb", "mariadbId"),
	...databaseRouter("mongo", "mongoId"),
	...databaseRouter("redis", "redisId"),
	...databaseRouter("libsql", "libsqlId"),

	"backup.*": lookup("backup", "backupId"),
	"backup.create": service(...DATABASE_KEYS, "composeId"),
	"backup.manualBackupWebServer": UNBOUND,
	"backup.restoreBackupWithLogs": service("databaseId"),

	"volumeBackups.*": lookup("volumeBackup", "volumeBackupId"),
	"volumeBackups.create": service(
		"applicationId",
		"composeId",
		...DATABASE_KEYS,
		"redisId",
	),
	// Restores into a volume named in the input, which may belong to any
	// environment on the server.
	"volumeBackups.restoreVolumeBackupWithLogs": UNBOUND,

	"domain.*": lookup("domain", "domainId"),
	"domain.create": service("applicationId", "composeId"),
	"domain.generateDomain": OUTSIDE,
	"domain.validateDomain": OUTSIDE,

	"mounts.*": lookup("mount", "mountId"),
	"mounts.create": service("serviceId"),

	"port.*": lookup("port", "portId"),
	"port.create": service("applicationId"),
	"redirects.*": lookup("redirect", "redirectId"),
	"redirects.create": service("applicationId"),
	"security.*": lookup("security", "securityId"),
	"security.create": service("applicationId"),

	"schedule.*": lookup("schedule", "scheduleId"),
	"schedule.create": service("applicationId", "composeId"),

	"deployment.*": lookup("deployment", "deploymentId"),
	"rollback.*": lookup("rollback", "rollbackId"),
	"previewDeployment.*": lookup("previewDeployment", "previewDeploymentId"),

	"patch.*": lookup("patch", "patchId"),
	"patch.create": service("applicationId", "composeId"),
	"patch.ensureRepo": service("id"),
	"patch.saveFileAsPatch": service("id"),
	"patch.markFileForDeletion": service("id"),
	"patch.cleanPatchRepos": UNBOUND,

	"environment.*": environment(),
	"environment.create": OUTSIDE,

	"project.*": { kind: "project", key: "projectId" },
	"project.create": OUTSIDE,
	"project.completeOnboarding": OUTSIDE,
	"project.duplicate": environment("sourceEnvironmentId"),

	"ai.*": OUTSIDE,
	"ai.deploy": environment(),

	"forwardAuth.*": UNBOUND,
	"forwardAuth.enable": lookup("domain", "domainId"),
	"forwardAuth.disable": lookup("domain", "domainId"),

	"docker.*": UNBOUND,
	"dockerVolume.*": UNBOUND,
	"dockerImage.*": UNBOUND,
	"dockerDiskUsage.*": UNBOUND,
	"network.*": UNBOUND,
	"cluster.*": UNBOUND,
	"server.*": UNBOUND,
	"settings.*": UNBOUND,
	"certificates.*": UNBOUND,
	"registry.*": UNBOUND,
	"destination.*": UNBOUND,
	"dnsProvider.*": UNBOUND,
	"vaultProvider.*": UNBOUND,
	"sshKey.*": UNBOUND,
	"gitProvider.*": UNBOUND,
	"github.*": UNBOUND,
	"gitlab.*": UNBOUND,
	"gitea.*": UNBOUND,
	"bitbucket.*": UNBOUND,

	"user.*": OUTSIDE,
	"notification.*": OUTSIDE,
	"oidcSso.*": OUTSIDE,
	"organization.*": OUTSIDE,
	"tag.*": OUTSIDE,
	"stripe.*": OUTSIDE,
	"admin.*": OUTSIDE,
	// Enterprise routers under /proprietary: classified by name only, their
	// code is never read (constitution I). Upstream reserves them to admins.
	"licenseKey.*": OUTSIDE,
	"whitelabeling.*": OUTSIDE,
	"customRole.*": OUTSIDE,
	"sso.*": OUTSIDE,
	"scim.*": OUTSIDE,
};

/** Queries that return secrets as free text, which cannot be masked by field (R6). */
export const SECRET_QUERY_POLICY: Readonly<Record<string, ReadOnlyRule>> = {
	"compose.getConvertedCompose": { kind: "secretQuery", keys: ["composeId"] },
	"compose.loadMountsByService": { kind: "secretQuery", keys: ["composeId"] },
	"application.readTraefikConfig": {
		kind: "secretQuery",
		keys: ["applicationId"],
	},
	"docker.getConfig": UNBOUND,
	"docker.readContainerFile": UNBOUND,
	"dockerVolume.readVolumeFile": UNBOUND,
};

export const resolveRule = (path: string): ReadOnlyRule | undefined => {
	const dot = path.indexOf(".");
	if (dot === -1) return undefined;
	return READ_ONLY_POLICY[path] ?? READ_ONLY_POLICY[`${path.slice(0, dot)}.*`];
};

export const readInputKey = (input: unknown, key: string): string | null => {
	const value =
		input instanceof FormData
			? input.get(key)
			: typeof input === "object" && input !== null
				? (input as Record<string, unknown>)[key]
				: undefined;
	return typeof value === "string" && value.length > 0 ? value : null;
};

const firstKey = (input: unknown, keys: readonly string[]) => {
	for (const key of keys) {
		const value = readInputKey(input, key);
		if (value) return value;
	}
	return null;
};

const SERVICE_TYPES = new Set([
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
]);

// Deep enough for any upstream input; deeper structures are not walked.
const MAX_DEPTH = 8;

const readOnlyIdInValue = (
	value: unknown,
	scope: ReadOnlySets,
	depth: number,
): string | null => {
	if (depth > MAX_DEPTH || typeof value !== "object" || value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const hit = readOnlyIdInValue(item, scope, depth + 1);
			if (hit) return hit;
		}
		return null;
	}
	const record =
		value instanceof FormData
			? Object.fromEntries(value.entries())
			: (value as Record<string, unknown>);
	for (const key of SERVICE_KEYS) {
		const id = readInputKey(record, key);
		if (id && scope.serviceIds.has(id)) return id;
	}
	for (const key of ENVIRONMENT_KEYS) {
		const id = readInputKey(record, key);
		if (id && scope.environmentIds.has(id)) return id;
	}
	// `{ id, type }` names a service, as in project.duplicate's selectedServices.
	const id = readInputKey(record, "id");
	if (
		id &&
		SERVICE_TYPES.has(String(record.type)) &&
		scope.serviceIds.has(id)
	) {
		return id;
	}
	for (const nested of Object.values(record)) {
		const hit = readOnlyIdInValue(nested, scope, depth + 1);
		if (hit) return hit;
	}
	return null;
};

// Any id of the read-only scope anywhere in the input denies, whatever the
// rule: it catches moves into production, updates that repoint a
// sub-resource, and nested lists of services such as project.duplicate's.
const readOnlyIdIn = (input: unknown, scope: ReadOnlySets) =>
	readOnlyIdInValue(input, scope, 0);

const denied = (resourceId?: string): ReadOnlyDecision => ({
	allow: false,
	resourceId,
});
const ALLOWED: ReadOnlyDecision = { allow: true };

const check = (id: string | null, readOnly: ReadonlySet<string>) =>
	id === null ? denied() : readOnly.has(id) ? denied(id) : ALLOWED;

/** Pure decision for one call of a member with a non-empty read-only scope. */
export const evaluate = (
	rule: ReadOnlyRule,
	input: unknown,
	scope: ReadOnlySets,
): ReadOnlyDecision => {
	const hit = readOnlyIdIn(input, scope);
	if (hit) return denied(hit);
	switch (rule.kind) {
		case "outside":
			return ALLOWED;
		case "unbound":
			return denied();
		case "service":
		case "secretQuery":
			return check(firstKey(input, rule.keys), scope.serviceIds);
		case "environment":
			return check(readInputKey(input, rule.key), scope.environmentIds);
		case "project":
			return check(readInputKey(input, rule.key), scope.projectIds);
		case "lookup": {
			const id = readInputKey(input, rule.key);
			return id ? { lookup: rule.resource, id } : denied();
		}
	}
};
