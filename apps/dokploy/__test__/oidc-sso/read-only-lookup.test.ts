import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real SQL: the owner of each sub-resource is read from the actual upstream
// tables, so it runs on PGlite with the full migration history.
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

const schema = await import("@dokploy/server/db/schema");
const { drizzleSubResourceOwner } = await import(
	"@dokploy/server/oidc-sso/read-only/lookup"
);

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const APP = "app-1";
const COMPOSE = "compose-1";
const PG = "pg-1";

beforeAll(async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const client = new PGlite();
	const folder = path.resolve(__dirname, "../../drizzle");
	const journal = JSON.parse(
		readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
	) as { entries: { tag: string }[] };
	for (const { tag } of journal.entries) {
		await client.exec(readFileSync(path.join(folder, `${tag}.sql`), "utf8"));
	}
	db = drizzle(client, { schema });
	holder.db = db;

	const now = new Date();
	await db.insert(schema.user).values({
		id: "owner",
		email: "owner@example.com",
		emailVerified: true,
		updatedAt: now,
	});
	await db.insert(schema.organization).values({
		id: "org",
		name: "org",
		ownerId: "owner",
		createdAt: now,
	});
	await db
		.insert(schema.projects)
		.values({ projectId: "p", name: "p", organizationId: "org" });
	await db
		.insert(schema.environments)
		.values({ environmentId: "e", projectId: "p", name: "staging" });
	await db
		.insert(schema.applications)
		.values({ applicationId: APP, name: "app", environmentId: "e" });
	await db
		.insert(schema.compose)
		.values({ composeId: COMPOSE, name: "compose", environmentId: "e" });
	await db.insert(schema.postgres).values({
		postgresId: PG,
		name: "pg",
		databaseName: "db",
		databaseUser: "u",
		databasePassword: "x",
		dockerImage: "postgres:16",
		environmentId: "e",
	});
	await db.insert(schema.destinations).values({
		destinationId: "dest",
		name: "dest",
		accessKey: "a",
		secretAccessKey: "s",
		bucket: "b",
		region: "r",
		endpoint: "https://s3.example.com",
		organizationId: "org",
	});

	await db.insert(schema.domains).values([
		{ domainId: "dom-app", host: "a.example.com", applicationId: APP },
		{ domainId: "dom-compose", host: "c.example.com", composeId: COMPOSE },
	]);
	await db.insert(schema.mounts).values([
		{
			mountId: "mount-pg",
			type: "volume",
			volumeName: "v",
			mountPath: "/data",
			serviceType: "postgres",
			postgresId: PG,
		},
		{
			mountId: "mount-orphan",
			type: "volume",
			volumeName: "v2",
			mountPath: "/data",
			serviceType: "application",
		},
	]);
	await db.insert(schema.ports).values({
		portId: "port-1",
		publishedPort: 8080,
		targetPort: 80,
		protocol: "tcp",
		applicationId: APP,
	});
	await db.insert(schema.redirects).values({
		redirectId: "redirect-1",
		regex: "^/a",
		replacement: "/b",
		applicationId: APP,
	});
	await db.insert(schema.security).values({
		securityId: "security-1",
		username: "u",
		password: "p",
		applicationId: APP,
	});
	await db.insert(schema.backups).values({
		backupId: "backup-pg",
		schedule: "0 0 * * *",
		prefix: "pg",
		database: "db",
		destinationId: "dest",
		databaseType: "postgres",
		postgresId: PG,
	});
	await db.insert(schema.volumeBackups).values({
		volumeBackupId: "vb-app",
		name: "vb",
		volumeName: "v",
		prefix: "vb",
		cronExpression: "0 0 * * *",
		serviceType: "application",
		destinationId: "dest",
		applicationId: APP,
	});
	await db.insert(schema.schedules).values([
		{
			scheduleId: "schedule-compose",
			name: "s",
			cronExpression: "* * * * *",
			command: "echo",
			composeId: COMPOSE,
		},
		{
			scheduleId: "schedule-server",
			name: "s2",
			cronExpression: "* * * * *",
			command: "echo",
			scheduleType: "server",
		},
	]);
	await db.insert(schema.previewDeployments).values({
		previewDeploymentId: "preview-1",
		branch: "feature",
		pullRequestId: "1",
		pullRequestNumber: "1",
		pullRequestURL: "https://example.com/pr/1",
		pullRequestTitle: "pr",
		pullRequestCommentId: "c",
		applicationId: APP,
	});
	await db.insert(schema.domains).values({
		domainId: "dom-preview",
		host: "pr.example.com",
		domainType: "preview",
		previewDeploymentId: "preview-1",
	});
	await db.insert(schema.deployments).values([
		{
			deploymentId: "deploy-compose",
			title: "d",
			logPath: "/logs/d",
			composeId: COMPOSE,
		},
		{
			deploymentId: "deploy-preview",
			title: "d",
			logPath: "/logs/p",
			previewDeploymentId: "preview-1",
		},
		{
			deploymentId: "deploy-schedule",
			title: "d",
			logPath: "/logs/s",
			scheduleId: "schedule-compose",
		},
		{
			deploymentId: "deploy-backup",
			title: "d",
			logPath: "/logs/b",
			backupId: "backup-pg",
		},
		{
			deploymentId: "deploy-volume-backup",
			title: "d",
			logPath: "/logs/v",
			volumeBackupId: "vb-app",
		},
		{ deploymentId: "deploy-server", title: "d", logPath: "/logs/x" },
	]);
	await db.insert(schema.rollbacks).values({
		rollbackId: "rollback-1",
		deploymentId: "deploy-compose",
		version: 1,
		image: "img",
		// The column is typed as the full upstream snapshot; the owner lookup
		// never reads it.
		fullContext: {} as never,
	});
	await db.insert(schema.patch).values({
		patchId: "patch-1",
		filePath: "a.txt",
		content: "x",
		type: "update",
		applicationId: APP,
	});
}, 120_000);

describe("drizzleSubResourceOwner (spec 006, FR-003, FR-005, research R5)", () => {
	it.each([
		["domain", "dom-app", APP],
		["domain", "dom-compose", COMPOSE],
		["domain", "dom-preview", APP],
		["mount", "mount-pg", PG],
		["port", "port-1", APP],
		["redirect", "redirect-1", APP],
		["security", "security-1", APP],
		["backup", "backup-pg", PG],
		["volumeBackup", "vb-app", APP],
		["schedule", "schedule-compose", COMPOSE],
		["deployment", "deploy-compose", COMPOSE],
		["deployment", "deploy-preview", APP],
		["deployment", "deploy-schedule", COMPOSE],
		["deployment", "deploy-backup", PG],
		["deployment", "deploy-volume-backup", APP],
		["rollback", "rollback-1", COMPOSE],
		["previewDeployment", "preview-1", APP],
		["patch", "patch-1", APP],
	] as const)(
		"resolves the %s %s to its service",
		async (resource, id, owner) => {
			await expect(drizzleSubResourceOwner.ownerOf(resource, id)).resolves.toBe(
				owner,
			);
		},
	);

	it.each([
		["mount", "mount-orphan"],
		["schedule", "schedule-server"],
		["deployment", "deploy-server"],
		["domain", "missing"],
		["patch", "missing"],
	] as const)(
		"FR-005: the %s %s has no service, so it resolves to null",
		async (resource, id) => {
			await expect(
				drizzleSubResourceOwner.ownerOf(resource, id),
			).resolves.toBeNull();
		},
	);
});

describe("performance · sub-resource lookup (spec 006, NFR-PERF-001)", () => {
	const p95 = (samples: number[]) =>
		[...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0;

	it.each([
		["a lookup mutation", "domain", "dom-app"],
		[
			"the deepest chain, a deployment log of a backup",
			"deployment",
			"deploy-backup",
		],
	] as const)("%s costs at most 5 ms p95", async (_label, resource, id) => {
		const samples: number[] = [];
		for (let i = 0; i < 200; i++) {
			const t0 = performance.now();
			await drizzleSubResourceOwner.ownerOf(resource, id);
			samples.push(performance.now() - t0);
		}
		expect(p95(samples)).toBeLessThanOrEqual(5);
	});
});
