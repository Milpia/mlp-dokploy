import type { SsoIdentity } from "@dokploy/server/oidc-sso/domain/claims";
import {
	type ProvisioningStore,
	type ProvisioningTx,
	provisionIdentity,
} from "@dokploy/server/oidc-sso/identity/provisioning";
import { describe, expect, it, vi } from "vitest";

const OWNER = { userId: "owner-id", organizationId: "org-1" };

const identity = (overrides: Partial<SsoIdentity> = {}): SsoIdentity => ({
	sub: "sub-1",
	email: "dev@example.com",
	emailVerified: true,
	givenName: "Ada",
	familyName: "Lovelace",
	groups: ["/dokploy-users"],
	...overrides,
});

const groups = { accessGroup: "dokploy-users", adminGroup: "dokploy-admins" };

const makeStore = (overrides: Partial<ProvisioningStore> = {}) => {
	const tx: { [K in keyof ProvisioningTx]: ReturnType<typeof vi.fn> } = {
		createUser: vi.fn(async () => "new-user-id"),
		upsertSsoAccount: vi.fn(async () => {}),
		ensureMembership: vi.fn(async () => {}),
	};
	const store = {
		findOwner: vi.fn(async () => OWNER),
		findUserBySub: vi.fn(async () => null),
		findUserByEmail: vi.fn(async () => null),
		transaction: vi.fn(async <T>(fn: (t: ProvisioningTx) => Promise<T>) =>
			fn(tx as never),
		),
		...overrides,
	};
	return { store: store as ProvisioningStore & typeof store, tx };
};

const run = (store: ProvisioningStore, id = identity(), config = groups) =>
	provisionIdentity({ store, identity: id, idToken: "id-token", ...config });

describe("provisionIdentity", () => {
	it("denies when there is no owner (fresh instance)", async () => {
		const { store, tx } = makeStore({ findOwner: vi.fn(async () => null) });
		await expect(run(store)).resolves.toEqual({
			allow: false,
			reason: "no_owner",
		});
		expect(tx.createUser).not.toHaveBeenCalled();
	});

	it("FR-007: creates user, account and membership in one transaction", async () => {
		const { store, tx } = makeStore();
		await expect(run(store)).resolves.toEqual({
			allow: true,
			userId: "new-user-id",
			isOwner: false,
			action: "create",
		});
		expect(store.transaction).toHaveBeenCalledTimes(1);
		expect(tx.createUser).toHaveBeenCalledWith({
			email: "dev@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
		});
		expect(tx.upsertSsoAccount).toHaveBeenCalledWith({
			userId: "new-user-id",
			sub: "sub-1",
			idToken: "id-token",
		});
		expect(tx.ensureMembership).toHaveBeenCalledWith({
			userId: "new-user-id",
			organizationId: "org-1",
			role: "member",
		});
	});

	it("FR-007: a failing step rolls the whole provisioning back", async () => {
		const { store, tx } = makeStore();
		tx.ensureMembership.mockRejectedValueOnce(new Error("constraint"));
		await expect(run(store)).rejects.toThrow("constraint");
	});

	it("FR-006: links by subject on later logins and refreshes the id token", async () => {
		const { store, tx } = makeStore({
			findUserBySub: vi.fn(async () => ({ id: "u1", banned: false })),
		});
		await expect(run(store)).resolves.toMatchObject({
			allow: true,
			userId: "u1",
			action: "login",
		});
		expect(store.findUserByEmail).not.toHaveBeenCalled();
		expect(tx.createUser).not.toHaveBeenCalled();
		expect(tx.upsertSsoAccount).toHaveBeenCalledWith({
			userId: "u1",
			sub: "sub-1",
			idToken: "id-token",
		});
	});

	it("FR-006: links an unlinked existing account by verified email", async () => {
		const { store, tx } = makeStore({
			findUserByEmail: vi.fn(async () => ({
				id: "u2",
				banned: false,
				linkedSub: null,
			})),
		});
		await expect(run(store)).resolves.toMatchObject({
			allow: true,
			userId: "u2",
		});
		expect(store.findUserByEmail).toHaveBeenCalledWith("dev@example.com");
		expect(tx.upsertSsoAccount).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "u2", sub: "sub-1" }),
		);
	});

	it("refuses an email already linked to another provider identity", async () => {
		const { store, tx } = makeStore({
			findUserByEmail: vi.fn(async () => ({
				id: "u2",
				banned: false,
				linkedSub: "someone-else",
			})),
		});
		await expect(run(store)).resolves.toEqual({
			allow: false,
			reason: "identity_conflict",
		});
		expect(tx.upsertSsoAccount).not.toHaveBeenCalled();
	});

	it("FR-006: never links by email when the email is unverified", async () => {
		const { store } = makeStore();
		await expect(
			run(store, identity({ emailVerified: false })),
		).resolves.toEqual({ allow: false, reason: "email_unverified" });
	});

	it("FR-008a: recalculates the role of an existing user on every login", async () => {
		const { store, tx } = makeStore({
			findUserBySub: vi.fn(async () => ({ id: "u1", banned: false })),
		});
		await run(
			store,
			identity({ groups: ["/dokploy-users", "/dokploy-admins"] }),
		);
		expect(tx.ensureMembership).toHaveBeenCalledWith({
			userId: "u1",
			organizationId: "org-1",
			role: "admin",
		});
	});

	it("FR-008: without an admin group, keeps the existing role", async () => {
		const { store, tx } = makeStore({
			findUserBySub: vi.fn(async () => ({ id: "u1", banned: false })),
		});
		await run(store, identity(), { ...groups, adminGroup: null as never });
		expect(tx.ensureMembership).toHaveBeenCalledWith({
			userId: "u1",
			organizationId: "org-1",
			role: null,
		});
	});

	it("FR-008b: never touches the owner's membership", async () => {
		const { store, tx } = makeStore({
			findUserByEmail: vi.fn(async () => ({
				id: OWNER.userId,
				banned: false,
				linkedSub: null,
			})),
		});
		await expect(run(store, identity({ groups: [] }))).resolves.toMatchObject({
			allow: true,
			isOwner: true,
		});
		expect(tx.ensureMembership).not.toHaveBeenCalled();
		expect(tx.upsertSsoAccount).toHaveBeenCalled();
	});

	it("FR-007b: denies an existing non-owner outside the access group", async () => {
		const { store, tx } = makeStore({
			findUserBySub: vi.fn(async () => ({ id: "u1", banned: false })),
		});
		await expect(run(store, identity({ groups: [] }))).resolves.toEqual({
			allow: false,
			reason: "not_in_access_group",
		});
		expect(store.transaction).not.toHaveBeenCalled();
		expect(tx.upsertSsoAccount).not.toHaveBeenCalled();
	});

	it("re-provisions a user deleted in Dokploy who is still in the group", async () => {
		const { store, tx } = makeStore();
		await expect(run(store)).resolves.toMatchObject({
			allow: true,
			action: "create",
		});
		expect(tx.createUser).toHaveBeenCalled();
	});

	it("denies a banned user", async () => {
		const { store } = makeStore({
			findUserBySub: vi.fn(async () => ({ id: "u1", banned: true })),
		});
		await expect(run(store)).resolves.toEqual({
			allow: false,
			reason: "user_banned",
		});
	});
});
