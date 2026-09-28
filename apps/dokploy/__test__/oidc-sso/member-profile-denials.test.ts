import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A developer's member row is written by the real applyGroupProfile, and the
// real upstream checks decide; nothing here reimplements a permission rule
// (spec 005, FR-008, FR-010, SC-002).
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn(async () => false),
}));

const schema = await import("@dokploy/server/db/schema");
const {
	checkEnvironmentAccess,
	checkPermission,
	checkProjectAccess,
	checkServiceAccess,
} = await import("@dokploy/server/services/permission");
const { applyGroupProfile } = await import(
	"@dokploy/server/oidc-sso/member-profile/apply"
);
const { drizzleMemberProfileStore } = await import(
	"@dokploy/server/oidc-sso/member-profile/store"
);
const { drizzleScopeCatalog } = await import(
	"@dokploy/server/oidc-sso/member-profile/scope"
);

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const ORG = "org-1";
const DEV = "dev-1";
const ctx = { user: { id: DEV }, session: { activeOrganizationId: ORG } };

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
	for (const id of ["owner-1", DEV]) {
		await db.insert(schema.user).values({
			id,
			email: `${id}@example.com`,
			emailVerified: true,
			updatedAt: now,
		});
	}
	await db
		.insert(schema.organization)
		.values({ id: ORG, name: ORG, ownerId: "owner-1", createdAt: now });
	await db.insert(schema.member).values([
		{ userId: "owner-1", organizationId: ORG, role: "owner", createdAt: now },
		// Manual permissions an admin set before the profile existed (FR-003).
		{
			userId: DEV,
			organizationId: ORG,
			role: "member",
			createdAt: now,
			canAccessToDocker: true,
			canCreateProjects: true,
		},
	]);
	for (const [projectId, name] of [
		["p-alpha", "alpha"],
		["p-gamma", "gamma"],
	] as const) {
		await db
			.insert(schema.projects)
			.values({ projectId, name, organizationId: ORG });
	}
	await db.insert(schema.environments).values([
		{ environmentId: "e-alpha-prod", projectId: "p-alpha", name: "production" },
		{ environmentId: "e-alpha-staging", projectId: "p-alpha", name: "staging" },
		{ environmentId: "e-gamma-prod", projectId: "p-gamma", name: "production" },
	]);
	await db.insert(schema.applications).values([
		{
			applicationId: "s-alpha-staging",
			name: "a",
			environmentId: "e-alpha-staging",
		},
		{ applicationId: "s-alpha-prod", name: "b", environmentId: "e-alpha-prod" },
		{ applicationId: "s-gamma-prod", name: "c", environmentId: "e-gamma-prod" },
	]);

	await applyGroupProfile({
		store: drizzleMemberProfileStore(db as never),
		catalog: drizzleScopeCatalog,
		userId: DEV,
		organizationId: ORG,
		groups: ["developers"],
		profiles: [
			{
				group: "developers",
				permissions: [],
				projects: ["alpha"],
				environments: { exclude: ["production"] },
			},
		],
		now,
	});
}, 120_000);

describe("a developer's profile against upstream checks (spec 005, US2)", () => {
	it("SC-001: operates what exists in its scope", async () => {
		await expect(
			checkServiceAccess(ctx, "s-alpha-staging"),
		).resolves.not.toThrow();
		await expect(
			checkEnvironmentAccess(ctx, "e-alpha-staging"),
		).resolves.not.toThrow();
		await expect(
			checkPermission(ctx, { deployment: ["create"], envVars: ["write"] }),
		).resolves.not.toThrow();
	});

	it.each([
		["create a project", { project: ["create"] }],
		["delete a project", { project: ["delete"] }],
		["create a service", { service: ["create"] }],
		["delete a service", { service: ["delete"] }],
		["create an environment", { environment: ["create"] }],
		["delete an environment", { environment: ["delete"] }],
		["read Docker", { docker: ["read"] }],
		["read Traefik files", { traefikFiles: ["read"] }],
		["read SSH keys", { sshKeys: ["read"] }],
		["read Git providers", { gitProviders: ["read"] }],
		["use the API", { api: ["read"] }],
		["change a member's permissions (NFR-SEC-002)", { member: ["update"] }],
		["invite someone", { invitation: ["create"] }],
	])("FR-008/SC-002: cannot %s", async (_label, permissions) => {
		await expect(
			checkPermission(ctx, permissions as never),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("FR-003: the manual permissions set before the profile are gone", async () => {
		await expect(
			checkPermission(ctx, { docker: ["read"] }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(checkProjectAccess(ctx, "create")).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("FR-010: a service of a project outside the scope is rejected", async () => {
		await expect(checkServiceAccess(ctx, "s-gamma-prod")).rejects.toMatchObject(
			{
				code: "UNAUTHORIZED",
			},
		);
	});

	it("FR-016: the excluded production environment and its services are rejected", async () => {
		await expect(checkServiceAccess(ctx, "s-alpha-prod")).rejects.toMatchObject(
			{
				code: "UNAUTHORIZED",
			},
		);
		await expect(
			checkEnvironmentAccess(ctx, "e-alpha-prod"),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
