import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The real adapters of the read-only checks, on PGlite with the full
// migration history; Docker is the only piece replaced.
const holder = vi.hoisted(() => ({
	db: null as unknown,
	labels: {} as Record<string, string>,
	inspect: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

vi.mock("@dokploy/server/utils/servers/remote-docker", () => ({
	getRemoteDocker: vi.fn(async () => ({
		getContainer: () => ({
			inspect: holder.inspect.mockImplementation(async () => ({
				Config: { Labels: holder.labels },
			})),
		}),
	})),
}));

const schema = await import("@dokploy/server/db/schema");
const {
	defaultContainerBindingDeps,
	defaultDeploymentLogDeps,
	defaultServerTerminalDeps,
} = await import("@dokploy/server/oidc-sso/read-only/wss");
const { defaultReadOnlyGuardDeps } = await import(
	"@dokploy/server/oidc-sso/read-only/guard"
);
const { memberProfileCache, readOnlyScopeCache } = await import(
	"@dokploy/server/oidc-sso/member-profile/cache"
);

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const recorded: unknown[] = [];
const services = {
	events: {
		record: async (event: unknown) => {
			recorded.push(event);
		},
	},
	config: { getEffective: async () => ({ groupProfiles: null }) },
} as never;

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
	for (const id of ["owner", "dev"]) {
		await db.insert(schema.user).values({
			id,
			email: `${id}@example.com`,
			emailVerified: true,
			updatedAt: now,
		});
	}
	await db.insert(schema.organization).values({
		id: "org",
		name: "org",
		ownerId: "owner",
		createdAt: now,
	});
	await db.insert(schema.member).values({
		userId: "dev",
		organizationId: "org",
		role: "member",
		createdAt: now,
		accessedServices: ["app-1"],
	});
	await db
		.insert(schema.projects)
		.values({ projectId: "p", name: "p", organizationId: "org" });
	await db
		.insert(schema.environments)
		.values({ environmentId: "e", projectId: "p", name: "staging" });
	await db.insert(schema.applications).values({
		applicationId: "app-1",
		name: "app",
		appName: "web-staging",
		environmentId: "e",
	});
	await db.insert(schema.redis).values({
		redisId: "redis-1",
		name: "redis",
		appName: "cache-staging",
		databasePassword: "x",
		dockerImage: "redis:7",
		environmentId: "e",
	});
	await db.insert(schema.deployments).values({
		deploymentId: "d1",
		title: "d",
		logPath: "/etc/dokploy/logs/web-staging/d1.log",
		applicationId: "app-1",
	});
}, 120_000);

describe("container binding adapters (spec 006, FR-004b)", () => {
	const deps = () => defaultContainerBindingDeps(services);

	it("finds the appName of a service in any of the service tables", async () => {
		await expect(deps().appNameOf("app-1")).resolves.toBe("web-staging");
		await expect(deps().appNameOf("redis-1")).resolves.toBe("cache-staging");
		await expect(deps().appNameOf("missing")).resolves.toBeNull();
	});

	it("reads the container labels through Docker", async () => {
		holder.labels = { "com.docker.swarm.service.name": "web-staging" };
		await expect(deps().labelsOf("c1", null)).resolves.toEqual(holder.labels);
	});

	it("a container without labels has none", async () => {
		holder.inspect.mockImplementationOnce(async () => ({}));
		const { getRemoteDocker } = await import(
			"@dokploy/server/utils/servers/remote-docker"
		);
		vi.mocked(getRemoteDocker).mockResolvedValueOnce({
			getContainer: () => ({ inspect: async () => ({}) }),
		} as never);
		await expect(deps().labelsOf("c2", null)).resolves.toEqual({});
	});

	it("reads the role, the profile cache, the scope and records events", async () => {
		const d = deps();
		await expect(d.findRole("dev", "org")).resolves.toBe("member");
		memberProfileCache.reset();
		expect(d.isProfiled("dev")).toBe(false);
		readOnlyScopeCache.reset();
		await expect(d.getScope("dev")).resolves.toMatchObject({
			serviceIds: new Set(),
		});
		await d.record({ type: "member_profile" } as never);
		expect(recorded).toHaveLength(1);
	});
});

describe("deployment log and server terminal adapters (spec 006, FR-004a, FR-004c)", () => {
	it("resolves a log path to its service and reads the member's services", async () => {
		const d = defaultDeploymentLogDeps(services);
		await expect(
			d.serviceOfLog("/etc/dokploy/logs/web-staging/d1.log"),
		).resolves.toBe("app-1");
		await expect(d.serviceOfLog("/nope.log")).resolves.toBeNull();
		await expect(d.accessedServices("dev", "org")).resolves.toEqual(["app-1"]);
		await expect(d.accessedServices("owner", "org")).resolves.toEqual([]);
		expect(d.isProfiled("dev")).toBe(false);
		await expect(d.findRole("dev", "org")).resolves.toBe("member");
		const before = recorded.length;
		await d.record({ type: "member_profile" } as never);
		expect(recorded).toHaveLength(before + 1);
	});

	it("checks the expiry through the 005 guard", async () => {
		memberProfileCache.reset();
		await expect(
			defaultDeploymentLogDeps(services).checkExpiry("dev", "org"),
		).resolves.toMatchObject({ ok: true });
	});

	it("the server terminal reads the read-only scope", async () => {
		readOnlyScopeCache.reset();
		await expect(
			defaultServerTerminalDeps(services).getScope("dev"),
		).resolves.toMatchObject({ environmentIds: new Set() });
	});
});

describe("tRPC guard adapters (spec 006, research R4)", () => {
	it("wires the cache, the scope, the owner lookup and the event store", async () => {
		const d = defaultReadOnlyGuardDeps(services as never);
		memberProfileCache.reset();
		expect(d.isProfiled("dev")).toBe(false);
		readOnlyScopeCache.reset();
		await expect(d.getScope("dev")).resolves.toMatchObject({
			projectIds: new Set(),
		});
		await expect(d.ownerOf("deployment", "d1")).resolves.toBe("app-1");
		await d.record({ type: "member_profile" } as never);
		expect(recorded.length).toBeGreaterThan(0);
	});
});
