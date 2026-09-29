import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The SSO login runs in the auth instance of whichever bundle created it
// first (the custom server), while the tRPC guard runs in the Next.js API
// bundle. Two copies of the modules on PGlite stand in for the two bundles.
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

const schema = await import("@dokploy/server/db/schema");
const guardSide = {
	...(await import("@dokploy/server/oidc-sso/read-only/guard")),
	...(await import("@dokploy/server/oidc-sso/member-profile/expiry")),
	...(await import("@dokploy/server/oidc-sso/member-profile/cache")),
};
vi.resetModules();
const loginSide = {
	...(await import("@dokploy/server/oidc-sso/identity/provisioning")),
	...(await import("@dokploy/server/oidc-sso/member-profile/cache")),
};

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const HOUR = 60 * 60 * 1000;
const QA = { sub: "kc-qa", email: "qa@example.com", groups: ["qa"] };
const DEV = { sub: "kc-dev", email: "dev@example.com", groups: ["developers"] };

type Profiles = Parameters<typeof loginSide.provisionIdentity>[0]["groupProfiles"];

const QA_READ_ONLY: Profiles = [
	{
		group: "qa",
		permissions: [],
		projects: ["milpia"],
		environments: { exclude: ["production"] },
		readOnly: true,
	},
];
const DEV_FULL: Profiles = [
	{ group: "developers", permissions: [], projects: ["milpia"] },
];
const DEV_PROD_READ_ONLY: Profiles = [
	{
		group: "developers",
		permissions: [],
		projects: ["milpia"],
		readOnly: ["production"],
	},
];

let activeProfiles: Profiles = [];
const services = {
	config: { getEffective: async () => ({ groupProfiles: activeProfiles }) },
	events: { record: async () => {} },
} as never;

const login = async (who: typeof QA, profiles: Profiles) => {
	activeProfiles = profiles;
	const result = await loginSide.provisionIdentity({
		store: loginSide.drizzleProvisioningStore,
		identity: { ...who, emailVerified: true },
		idToken: "id-token",
		accessGroup: "qa,developers",
		adminGroup: "admins",
		groupProfiles: profiles,
	});
	if (!result.allow) throw new Error(`login denied: ${result.reason}`);
	return result.userId;
};

// protectedProcedure's chain: the expiry guard, then the read-only guard.
const saveEnvironment = async (
	userId: string,
	applicationId: string,
	at = new Date(),
) => {
	const expiry = await guardSide.checkMemberProfileExpiry(
		{ id: userId, role: "member" },
		{
			...guardSide.defaultMemberProfileExpiryDeps(services),
			now: () => at,
		},
	);
	expect(expiry.ok).toBe(true);
	const verdict = await guardSide.checkReadOnlyCall(
		{
			user: { id: userId, role: "member" },
			path: "application.saveEnvironment",
			type: "mutation",
			getRawInput: async () => ({ applicationId, env: "A=1" }),
		},
		guardSide.defaultReadOnlyGuardDeps(services),
	);
	return { expiry, verdict: verdict.kind };
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
	// PGlite has one connection: the login reads the catalog through the
	// global db while its transaction is open, which in Postgres goes to
	// another connection and here would wait forever. Inside a transaction,
	// the global db is that transaction.
	let current: object = db;
	const transaction = (fn: (tx: unknown) => Promise<unknown>) =>
		db.transaction(async (tx) => {
			const previous = current;
			current = tx;
			try {
				return await fn(tx);
			} finally {
				current = previous;
			}
		});
	holder.db = new Proxy(
		{},
		{
			get(_target, key) {
				if (key === "transaction") return transaction;
				const value = Reflect.get(current, key);
				return typeof value === "function" ? value.bind(current) : value;
			},
		},
	);

	const now = new Date();
	await db.insert(schema.user).values({
		id: "owner",
		email: "owner@example.com",
		emailVerified: true,
		updatedAt: now,
	});
	await db
		.insert(schema.organization)
		.values({ id: "org", name: "org", ownerId: "owner", createdAt: now });
	await db.insert(schema.member).values({
		userId: "owner",
		organizationId: "org",
		role: "owner",
		createdAt: now,
	});
	await db
		.insert(schema.projects)
		.values({ projectId: "p", name: "milpia", organizationId: "org" });
	await db.insert(schema.environments).values([
		{ environmentId: "e-stg", projectId: "p", name: "staging" },
		{ environmentId: "e-prod", projectId: "p", name: "production" },
	]);
	await db.insert(schema.applications).values([
		{
			applicationId: "app-stg",
			name: "web",
			appName: "web-stg",
			environmentId: "e-stg",
		},
		{
			applicationId: "app-prod",
			name: "web",
			appName: "web-prod",
			environmentId: "e-prod",
		},
	]);
}, 120_000);

beforeEach(() => {
	guardSide.readOnlyScopeCache.reset();
	guardSide.memberProfileCache.reset();
	loginSide.readOnlyScopeCache.reset();
	loginSide.memberProfileCache.reset();
});

describe("a login refreshes the read-only scope the guard reads (spec 006, FR-008)", () => {
	it("the login and the guard sides are separate module copies", () => {
		expect(loginSide.readOnlyScopeCache).not.toBe(
			guardSide.readOnlyScopeCache,
		);
	});

	it("login, expiry and a new login without a restart: the mutation is still denied", async () => {
		const qa = await login(QA, QA_READ_ONLY);
		await expect(saveEnvironment(qa, "app-stg")).resolves.toMatchObject({
			verdict: "deny",
		});

		const later = new Date(Date.now() + 9 * HOUR);
		await expect(saveEnvironment(qa, "app-stg", later)).resolves.toMatchObject(
			{ expiry: { ok: true, outcome: "expired" }, verdict: "pass" },
		);

		await login(QA, QA_READ_ONLY);
		await expect(saveEnvironment(qa, "app-stg")).resolves.toMatchObject({
			verdict: "deny",
		});
	});

	it("a profile that gains readOnly between two logins applies from the second one", async () => {
		const dev = await login(DEV, DEV_FULL);
		await expect(saveEnvironment(dev, "app-prod")).resolves.toMatchObject({
			verdict: "pass",
		});

		await login(DEV, DEV_PROD_READ_ONLY);
		await expect(saveEnvironment(dev, "app-prod")).resolves.toMatchObject({
			verdict: "deny",
		});
		await expect(saveEnvironment(dev, "app-stg")).resolves.toMatchObject({
			verdict: "allow",
		});
	});
});
