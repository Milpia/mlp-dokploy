import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real SQL: the scope is resolved against the actual project, environment and
// service tables, so it runs on PGlite with the full migration history.
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

const schema = await import("@dokploy/server/db/schema");
const { checkGroupProfiles, drizzleScopeCatalog, resolveScope } = await import(
	"@dokploy/server/oidc-sso/member-profile/scope"
);

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ids: Record<string, string> = {};

const addProject = async (key: string, name: string, organizationId = ORG) => {
	ids[key] = `project-${key}`;
	await db.insert(schema.projects).values({
		projectId: ids[key],
		name,
		organizationId,
	});
};

const addEnvironment = async (
	key: string,
	projectKey: string,
	name: string,
) => {
	ids[key] = `env-${key}`;
	await db.insert(schema.environments).values({
		environmentId: ids[key],
		projectId: ids[projectKey] as string,
		name,
	});
};

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
	for (const [userId, orgId] of [
		["owner-1", ORG],
		["owner-2", OTHER_ORG],
	] as const) {
		await db.insert(schema.user).values({
			id: userId,
			email: `${userId}@example.com`,
			emailVerified: true,
			updatedAt: now,
		});
		await db.insert(schema.organization).values({
			id: orgId,
			name: orgId,
			ownerId: userId,
			createdAt: now,
		});
	}

	await addProject("alpha", "alpha");
	await addEnvironment("alphaProd", "alpha", "production");
	await addEnvironment("alphaStaging", "alpha", "staging");
	await addProject("beta", "beta");
	await addEnvironment("betaProd", "beta", "production");
	await addEnvironment("betaStaging", "beta", "staging");
	await addProject("beta2", "beta");
	await addEnvironment("beta2Dev", "beta2", "dev");
	await addProject("gamma", "gamma");
	await addEnvironment("gammaProd", "gamma", "production");
	await addProject("foreign", "alpha", OTHER_ORG);
	await addEnvironment("foreignStaging", "foreign", "staging");

	const secret = { databasePassword: "x", databaseUser: "u" };
	const env = ids.alphaStaging as string;
	await db.insert(schema.applications).values({
		applicationId: "svc-app",
		name: "app",
		environmentId: env,
	});
	await db.insert(schema.compose).values({
		composeId: "svc-compose",
		name: "compose",
		environmentId: env,
	});
	await db.insert(schema.postgres).values({
		postgresId: "svc-postgres",
		name: "pg",
		databaseName: "db",
		dockerImage: "postgres:16",
		environmentId: env,
		...secret,
	});
	await db.insert(schema.mysql).values({
		mysqlId: "svc-mysql",
		name: "mysql",
		databaseName: "db",
		databaseRootPassword: "x",
		dockerImage: "mysql:8",
		environmentId: env,
		...secret,
	});
	await db.insert(schema.mariadb).values({
		mariadbId: "svc-mariadb",
		name: "mariadb",
		databaseName: "db",
		databaseRootPassword: "x",
		dockerImage: "mariadb:11",
		environmentId: env,
		...secret,
	});
	await db.insert(schema.mongo).values({
		mongoId: "svc-mongo",
		name: "mongo",
		environmentId: env,
		...secret,
	});
	await db.insert(schema.redis).values({
		redisId: "svc-redis",
		name: "redis",
		databasePassword: "x",
		dockerImage: "redis:7",
		environmentId: env,
	});
	await db.insert(schema.libsql).values({
		libsqlId: "svc-libsql",
		name: "libsql",
		dockerImage: "libsql:latest",
		environmentId: env,
		...secret,
	});
	await db.insert(schema.applications).values({
		applicationId: "svc-alpha-prod",
		name: "prod-app",
		environmentId: ids.alphaProd as string,
	});
	await db.insert(schema.applications).values({
		applicationId: "svc-foreign",
		name: "foreign-app",
		environmentId: ids.foreignStaging as string,
	});
}, 120_000);

const resolve = (scopes: Parameters<typeof resolveScope>[0]) =>
	resolveScope(scopes, ORG, drizzleScopeCatalog);

const NO_READ_ONLY = { environmentIds: [], serviceIds: [], projectIds: [] };

const ALPHA_STAGING_SERVICES = [
	"svc-app",
	"svc-compose",
	"svc-libsql",
	"svc-mariadb",
	"svc-mongo",
	"svc-mysql",
	"svc-postgres",
	"svc-redis",
];

describe("resolveScope read-only (spec 006, FR-001, FR-007, R2)", () => {
	it("readOnly true marks every environment of the group, its services and projects", async () => {
		const scope = await resolve([
			{
				projects: ["alpha"],
				environments: { exclude: ["production"] },
				readOnly: true,
			},
		]);
		expect(scope.readOnly).toEqual({
			environmentIds: [ids.alphaStaging],
			serviceIds: expect.arrayContaining(ALPHA_STAGING_SERVICES),
			projectIds: [ids.alpha],
		});
		expect(scope.readOnly.serviceIds).toHaveLength(
			ALPHA_STAGING_SERVICES.length,
		);
	});

	it("a list marks only the named environments", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], readOnly: ["production"] },
		]);
		expect(scope.readOnly).toEqual({
			environmentIds: [ids.alphaProd],
			serviceIds: ["svc-alpha-prod"],
			projectIds: [ids.alpha],
		});
	});

	it("keeps read-only environments and services in the upstream scope", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], readOnly: ["production"] },
		]);
		expect(scope.environmentIds).toContain(ids.alphaProd);
		expect(scope.serviceIds).toContain("svc-alpha-prod");
	});

	it("FR-007: full access in one group wins over read-only in another", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], readOnly: ["production"] },
			{
				projects: ["alpha"],
				environments: { exclude: ["production"] },
				readOnly: true,
			},
		]);
		expect(scope.readOnly).toEqual({
			environmentIds: [ids.alphaProd],
			serviceIds: ["svc-alpha-prod"],
			projectIds: [ids.alpha],
		});
	});

	it("FR-007: an environment read-only in every group stays read-only", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], readOnly: true },
			{ projects: ["alpha"], readOnly: ["staging", "production"] },
		]);
		expect(scope.readOnly.environmentIds.sort()).toEqual(
			[ids.alphaProd, ids.alphaStaging].sort(),
		);
	});

	it("no readOnly anywhere gives three empty lists", async () => {
		const scope = await resolve([{ projects: ["alpha"] }]);
		expect(scope.readOnly).toEqual(NO_READ_ONLY);
	});
});

describe("resolveScope (spec 005, FR-002, FR-016, R5)", () => {
	it("resolves projects by name to all their environments and services", async () => {
		const scope = await resolve([{ projects: ["alpha"] }]);
		expect(scope.projectIds).toEqual([ids.alpha]);
		expect(scope.environmentIds.sort()).toEqual(
			[ids.alphaProd, ids.alphaStaging].sort(),
		);
		expect(scope.serviceIds.sort()).toEqual(
			[
				"svc-alpha-prod",
				"svc-app",
				"svc-compose",
				"svc-libsql",
				"svc-mariadb",
				"svc-mongo",
				"svc-mysql",
				"svc-postgres",
				"svc-redis",
			].sort(),
		);
	});

	it("FR-016: excludes environments by name, and their services", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], environments: { exclude: ["production"] } },
		]);
		expect(scope.environmentIds).toEqual([ids.alphaStaging]);
		expect(scope.serviceIds).not.toContain("svc-alpha-prod");
		expect(scope.serviceIds).toContain("svc-redis");
	});

	it("includes only the listed environments", async () => {
		const scope = await resolve([
			{ projects: ["alpha", "beta"], environments: { include: ["staging"] } },
		]);
		expect(scope.environmentIds.sort()).toEqual(
			[ids.alphaStaging, ids.betaStaging].sort(),
		);
		expect(scope.projectIds.sort()).toEqual([ids.alpha, ids.beta].sort());
	});

	it("includes every project with a matching name", async () => {
		const scope = await resolve([{ projects: ["beta"] }]);
		expect(scope.projectIds.sort()).toEqual([ids.beta, ids.beta2].sort());
	});

	it("leaves out a project whose environments are all excluded", async () => {
		const scope = await resolve([
			{ projects: ["gamma"], environments: { exclude: ["production"] } },
		]);
		expect(scope).toEqual({
			projectIds: [],
			environmentIds: [],
			serviceIds: [],
			readOnly: NO_READ_ONLY,
		});
	});

	it("ignores unknown names and never reaches another organization", async () => {
		const scope = await resolve([{ projects: ["delta", "alpha"] }]);
		expect(scope.projectIds).toEqual([ids.alpha]);
		expect(scope.serviceIds).not.toContain("svc-foreign");
	});

	it("FR-006: unions the scopes of several groups", async () => {
		const scope = await resolve([
			{ projects: ["alpha"], environments: { exclude: ["production"] } },
			{ projects: ["alpha"], environments: { include: ["production"] } },
			{ projects: ["gamma"] },
		]);
		expect(scope.environmentIds.sort()).toEqual(
			[ids.alphaProd, ids.alphaStaging, ids.gammaProd].sort(),
		);
	});

	it("returns an empty scope for no projects", async () => {
		await expect(resolve([{ projects: [] }])).resolves.toEqual({
			projectIds: [],
			environmentIds: [],
			serviceIds: [],
			readOnly: NO_READ_ONLY,
		});
	});
});

describe("checkGroupProfiles (spec 005, R5)", () => {
	it("reports missing and ambiguous project names per group", async () => {
		await expect(
			checkGroupProfiles(
				[
					{
						group: "developers",
						permissions: [],
						projects: ["alpha", "beta", "delta"],
					},
					{ group: "qa", permissions: [], projects: [] },
				],
				ORG,
				drizzleScopeCatalog,
			),
		).resolves.toEqual([
			{
				group: "developers",
				missingProjects: ["delta"],
				ambiguousProjects: ["beta"],
				projectsResolved: 3,
				missingReadOnlyEnvironments: [],
			},
			{
				group: "qa",
				missingProjects: [],
				ambiguousProjects: [],
				projectsResolved: 0,
				missingReadOnlyEnvironments: [],
			},
		]);
	});

	it("spec 006 R8: reports read-only environment names that match nothing", async () => {
		const [check] = await checkGroupProfiles(
			[
				{
					group: "developers",
					permissions: [],
					projects: ["alpha", "gamma"],
					readOnly: ["production", "prodution"],
				},
			],
			ORG,
			drizzleScopeCatalog,
		);
		expect(check?.missingReadOnlyEnvironments).toEqual(["prodution"]);
	});

	it("spec 006 R8: readOnly true has nothing to report", async () => {
		const [check] = await checkGroupProfiles(
			[{ group: "qa", permissions: [], projects: ["alpha"], readOnly: true }],
			ORG,
			drizzleScopeCatalog,
		);
		expect(check?.missingReadOnlyEnvironments).toEqual([]);
	});
});
