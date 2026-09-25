import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real SQL for the Drizzle adapters: an in-memory Postgres (PGlite) with the
// repository's full migration history applied, instead of the global db mock.
const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@dokploy/server/db", () => ({
	get db() {
		return holder.db;
	},
	dbUrl: "postgres://unused",
}));

const schema = await import("@dokploy/server/db/schema");
const { drizzleConfigRepository } = await import(
	"@dokploy/server/keycloak-sso/config/repository"
);
const { drizzleAuthEventStore } = await import(
	"@dokploy/server/keycloak-sso/events/auth-events"
);
const {
	drizzleProvisioningStore,
	findKeycloakIdToken,
	findOwnerEmail,
	provisionIdentity,
} = await import("@dokploy/server/keycloak-sso/identity/provisioning");
const { ownerHasEnterpriseLicense, getKeycloakSsoServices } = await import(
	"@dokploy/server/keycloak-sso/services"
);

type Db = import("drizzle-orm/pglite").PgliteDatabase<typeof schema>;
let db: Db;

const OWNER_ID = "owner-user";
const ORG_ID = "org-1";

beforeAll(async () => {
	const { PGlite } = await import("@electric-sql/pglite");
	const { drizzle } = await import("drizzle-orm/pglite");
	const client = new PGlite();
	// Drizzle's PGlite migrator uses prepared statements, which old migrations
	// with several statements per chunk do not support; exec() does.
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
		id: OWNER_ID,
		email: "Owner@Example.com",
		emailVerified: true,
		updatedAt: now,
	});
	await db.insert(schema.organization).values({
		id: ORG_ID,
		name: "My Organization",
		ownerId: OWNER_ID,
		createdAt: now,
	});
	await db.insert(schema.member).values({
		userId: OWNER_ID,
		organizationId: ORG_ID,
		role: "owner",
		createdAt: now,
		isDefault: true,
	});
}, 120_000);

describe("drizzleConfigRepository (FR-001, FR-015)", () => {
	it("returns defaults before anything is saved", async () => {
		await expect(drizzleConfigRepository.get()).resolves.toMatchObject({
			mode: "disabled",
			clientSecret: null,
			buttonLabel: "Sign in with Keycloak",
		});
	});

	it("stores the client secret encrypted and reads it back decrypted", async () => {
		await drizzleConfigRepository.save({
			mode: "button",
			issuerUrl: "https://kc.example.com/realms/milpia",
			clientId: "dokploy",
			clientSecret: "super-secret",
		});
		const [row] = await db.select().from(schema.keycloakSsoConfig);
		expect(row?.clientSecret).toMatch(/^enc:v1:/);
		expect(row?.clientSecret).not.toContain("super-secret");
		await expect(drizzleConfigRepository.get()).resolves.toMatchObject({
			mode: "button",
			clientSecret: "super-secret",
		});
	});

	it("updates the single row instead of inserting another", async () => {
		await drizzleConfigRepository.save({ buttonLabel: "Entrar" });
		expect(await db.select().from(schema.keycloakSsoConfig)).toHaveLength(1);
		await expect(drizzleConfigRepository.get()).resolves.toMatchObject({
			buttonLabel: "Entrar",
			clientSecret: "super-secret",
		});
	});

	it("an explicit null clears the secret", async () => {
		await drizzleConfigRepository.save({ clientSecret: null });
		await expect(drizzleConfigRepository.get()).resolves.toMatchObject({
			clientSecret: null,
		});
		await drizzleConfigRepository.save({ clientSecret: "super-secret" });
	});

	it("treats an undecryptable secret as missing (e.g. rotated key)", async () => {
		const [row] = await db.select().from(schema.keycloakSsoConfig);
		await db
			.update(schema.keycloakSsoConfig)
			.set({ clientSecret: "enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })
			.where(
				(await import("drizzle-orm")).eq(
					schema.keycloakSsoConfig.id,
					row?.id ?? "",
				),
			);
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(drizzleConfigRepository.get()).resolves.toMatchObject({
			clientSecret: null,
		});
		expect(errors).toHaveBeenCalled();
		errors.mockRestore();
		await drizzleConfigRepository.save({ clientSecret: "super-secret" });
	});
});

describe("drizzleAuthEventStore (FR-013)", () => {
	it("inserts, lists newest first and prunes by date", async () => {
		await drizzleAuthEventStore.insert({
			type: "sso_login",
			outcome: "success",
			correlationId: "OLD",
			email: "a@example.com",
		});
		await db
			.update(schema.keycloakAuthEvent)
			.set({ createdAt: new Date("2020-01-01") });
		await drizzleAuthEventStore.insert({
			type: "sso_login",
			outcome: "denied",
			reason: "not_in_access_group",
			correlationId: "NEW",
			ip: "10.0.0.1",
			userId: "u",
		});

		const recent = await drizzleAuthEventStore.listRecent(10);
		expect(recent.map((e) => e.correlationId)).toEqual(["NEW", "OLD"]);
		expect(recent[0]).toMatchObject({
			reason: "not_in_access_group",
			ip: "10.0.0.1",
			userId: "u",
		});

		await drizzleAuthEventStore.deleteOlderThan(new Date("2021-01-01"));
		expect(
			(await drizzleAuthEventStore.listRecent(10)).map((e) => e.correlationId),
		).toEqual(["NEW"]);
	});
});

describe("drizzleProvisioningStore (FR-006, FR-007, FR-008)", () => {
	const identity = {
		sub: "kc-sub-dev",
		email: "dev@example.com",
		emailVerified: true,
		givenName: "Ada",
		familyName: "Lovelace",
		groups: ["/dokploy-users", "/dokploy-admins"],
	};

	it("finds the owner and its email", async () => {
		await expect(drizzleProvisioningStore.findOwner()).resolves.toEqual({
			userId: OWNER_ID,
			organizationId: ORG_ID,
		});
		await expect(findOwnerEmail()).resolves.toBe("Owner@Example.com");
	});

	it("creates user, account and membership in one transaction", async () => {
		const result = await provisionIdentity({
			store: drizzleProvisioningStore,
			identity,
			idToken: "id-token-1",
			accessGroup: "dokploy-users",
			adminGroup: "dokploy-admins",
		});
		expect(result).toMatchObject({ allow: true, action: "create" });
		if (!result.allow) return;

		const created = await db.query.user.findFirst({
			where: (u, { eq }) => eq(u.id, result.userId),
		});
		expect(created).toMatchObject({
			email: "dev@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			emailVerified: true,
		});
		const membership = await db.query.member.findFirst({
			where: (m, { eq }) => eq(m.userId, result.userId),
		});
		expect(membership).toMatchObject({
			organizationId: ORG_ID,
			role: "admin",
			isDefault: true,
		});
		await expect(findKeycloakIdToken(result.userId)).resolves.toBe(
			"id-token-1",
		);
	});

	it("links by subject on the next login, refreshes the token and downgrades the role", async () => {
		const result = await provisionIdentity({
			store: drizzleProvisioningStore,
			identity: { ...identity, groups: ["/dokploy-users"] },
			idToken: "id-token-2",
			accessGroup: "dokploy-users",
			adminGroup: "dokploy-admins",
		});
		expect(result).toMatchObject({ allow: true, action: "login" });
		if (!result.allow) return;
		await expect(findKeycloakIdToken(result.userId)).resolves.toBe(
			"id-token-2",
		);
		const membership = await db.query.member.findFirst({
			where: (m, { eq }) => eq(m.userId, result.userId),
		});
		expect(membership?.role).toBe("member");
		const links = await db.query.account.findMany({
			where: (a, { eq }) => eq(a.userId, result.userId),
		});
		expect(links).toHaveLength(1);
	});

	it("links the owner by email case-insensitively and never changes its role", async () => {
		const result = await provisionIdentity({
			store: drizzleProvisioningStore,
			identity: {
				...identity,
				sub: "kc-sub-owner",
				email: "owner@example.com",
				groups: [],
			},
			idToken: "owner-token",
			accessGroup: "dokploy-users",
			adminGroup: "dokploy-admins",
		});
		expect(result).toMatchObject({ allow: true, isOwner: true });
		const membership = await db.query.member.findFirst({
			where: (m, { eq }) => eq(m.userId, OWNER_ID),
		});
		expect(membership?.role).toBe("owner");
		await expect(
			drizzleProvisioningStore.findUserBySub("kc-sub-owner"),
		).resolves.toEqual({ id: OWNER_ID, banned: false });
	});

	it("reports an email already linked to another Keycloak identity", async () => {
		await expect(
			drizzleProvisioningStore.findUserByEmail("DEV@example.com"),
		).resolves.toMatchObject({ linkedSub: "kc-sub-dev" });
	});

	it("rolls everything back when a step fails", async () => {
		const before = await db.select().from(schema.user);
		await expect(
			drizzleProvisioningStore.transaction(async (tx) => {
				await tx.createUser({
					email: "rollback@example.com",
					firstName: "",
					lastName: "",
				});
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await db.select().from(schema.user)).toHaveLength(before.length);
	});

	it("adds a membership to an existing user who had none, keeping their default", async () => {
		const now = new Date();
		await db.insert(schema.user).values({
			id: "lonely",
			email: "lonely@example.com",
			emailVerified: true,
			updatedAt: now,
		});
		await drizzleProvisioningStore.transaction((tx) =>
			tx.ensureMembership({
				userId: "lonely",
				organizationId: ORG_ID,
				role: null,
			}),
		);
		const membership = await db.query.member.findFirst({
			where: (m, { eq }) => eq(m.userId, "lonely"),
		});
		expect(membership).toMatchObject({ role: "member", isDefault: true });
	});

	it("returns null for unknown users", async () => {
		await expect(
			drizzleProvisioningStore.findUserBySub("nobody"),
		).resolves.toBeNull();
		await expect(
			drizzleProvisioningStore.findUserByEmail("nobody@example.com"),
		).resolves.toBeNull();
		await expect(findKeycloakIdToken("nobody")).resolves.toBeNull();
	});
});

describe("services wiring", () => {
	it("FR-017: detects the owner's enterprise license from upstream columns", async () => {
		await expect(ownerHasEnterpriseLicense()).resolves.toBe(false);
		await db
			.update(schema.user)
			.set({ enableEnterpriseFeatures: true, isValidEnterpriseLicense: true })
			.where((await import("drizzle-orm")).eq(schema.user.id, OWNER_ID));
		await expect(ownerHasEnterpriseLicense()).resolves.toBe(true);
		await db
			.update(schema.user)
			.set({ enableEnterpriseFeatures: false, isValidEnterpriseLicense: false })
			.where((await import("drizzle-orm")).eq(schema.user.id, OWNER_ID));
	});

	it("shares one set of services per process", () => {
		expect(getKeycloakSsoServices()).toBe(getKeycloakSsoServices());
	});
});
