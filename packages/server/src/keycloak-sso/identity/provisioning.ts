import { db } from "@dokploy/server/db";
import { account, member, user } from "@dokploy/server/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { decideAccess } from "../domain/access-policy";
import type { KeycloakIdentity } from "../domain/claims";
import { type DenyReason, KEYCLOAK_PROVIDER_ID, type SsoRole } from "../types";

export interface UserRecord {
	id: string;
	banned: boolean;
}

export interface ProvisioningTx {
	createUser(input: {
		email: string;
		firstName: string;
		lastName: string;
	}): Promise<string>;
	upsertKeycloakAccount(input: {
		userId: string;
		sub: string;
		idToken: string;
	}): Promise<void>;
	/** `role: null` keeps the current role; a missing membership becomes member. */
	ensureMembership(input: {
		userId: string;
		organizationId: string;
		role: SsoRole | null;
	}): Promise<void>;
}

export interface ProvisioningStore {
	findOwner(): Promise<{ userId: string; organizationId: string } | null>;
	findUserBySub(sub: string): Promise<UserRecord | null>;
	findUserByEmail(
		email: string,
	): Promise<(UserRecord & { linkedSub: string | null }) | null>;
	transaction<T>(fn: (tx: ProvisioningTx) => Promise<T>): Promise<T>;
}

export interface ProvisionInput {
	store: ProvisioningStore;
	identity: KeycloakIdentity;
	idToken: string;
	accessGroup: string | null;
	adminGroup: string | null;
}

export type ProvisionResult =
	| {
			allow: true;
			userId: string;
			isOwner: boolean;
			action: "login" | "create";
	  }
	| { allow: false; reason: DenyReason };

export const provisionIdentity = async ({
	store,
	identity,
	idToken,
	accessGroup,
	adminGroup,
}: ProvisionInput): Promise<ProvisionResult> => {
	const owner = await store.findOwner();

	let existing: UserRecord | null = await store.findUserBySub(identity.sub);
	if (!existing && identity.email && identity.emailVerified) {
		const byEmail = await store.findUserByEmail(identity.email);
		if (byEmail?.linkedSub && byEmail.linkedSub !== identity.sub) {
			return { allow: false, reason: "identity_conflict" };
		}
		existing = byEmail;
	}

	const isOwner = !!owner && existing?.id === owner.userId;
	const decision = decideAccess({
		identity,
		existingUser: existing
			? { id: existing.id, banned: existing.banned, isOwner }
			: null,
		ownerExists: !!owner,
		accessGroup,
		adminGroup,
	});
	if (!decision.allow || !owner) {
		return {
			allow: false,
			reason: decision.allow ? "no_owner" : decision.reason,
		};
	}

	const userId = await store.transaction(async (tx) => {
		const id =
			existing?.id ??
			(await tx.createUser({
				// decideAccess guarantees a verified email at this point.
				email: identity.email as string,
				firstName: identity.givenName ?? "",
				lastName: identity.familyName ?? "",
			}));
		await tx.upsertKeycloakAccount({ userId: id, sub: identity.sub, idToken });
		if (!isOwner) {
			await tx.ensureMembership({
				userId: id,
				organizationId: owner.organizationId,
				role: decision.role === "unchanged" ? null : decision.role,
			});
		}
		return id;
	});

	return { allow: true, userId, isOwner, action: decision.action };
};

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const drizzleTx = (tx: Tx): ProvisioningTx => ({
	async createUser({ email, firstName, lastName }) {
		const now = new Date();
		const [created] = await tx
			.insert(user)
			.values({
				email,
				firstName,
				lastName,
				emailVerified: true,
				isRegistered: true,
				updatedAt: now,
			})
			.returning({ id: user.id });
		if (!created) throw new Error("Keycloak SSO: user could not be created");
		return created.id;
	},

	async upsertKeycloakAccount({ userId, sub, idToken }) {
		const now = new Date();
		const linked = await tx.query.account.findFirst({
			where: and(
				eq(account.providerId, KEYCLOAK_PROVIDER_ID),
				eq(account.accountId, sub),
			),
		});
		if (linked) {
			await tx
				.update(account)
				.set({ idToken, updatedAt: now })
				.where(eq(account.id, linked.id));
			return;
		}
		await tx.insert(account).values({
			providerId: KEYCLOAK_PROVIDER_ID,
			accountId: sub,
			userId,
			idToken,
			createdAt: now,
			updatedAt: now,
		});
	},

	async ensureMembership({ userId, organizationId, role }) {
		const current = await tx.query.member.findFirst({
			where: and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
			),
		});
		if (!current) {
			const hasDefault = await tx.query.member.findFirst({
				where: and(eq(member.userId, userId), eq(member.isDefault, true)),
			});
			await tx.insert(member).values({
				userId,
				organizationId,
				role: role ?? "member",
				createdAt: new Date(),
				isDefault: !hasDefault,
			});
			return;
		}
		if (role && current.role !== "owner" && current.role !== role) {
			await tx.update(member).set({ role }).where(eq(member.id, current.id));
		}
	},
});

export const drizzleProvisioningStore: ProvisioningStore = {
	async findOwner() {
		const owner = await db.query.member.findFirst({
			where: eq(member.role, "owner"),
			orderBy: (m, { asc }) => [asc(m.createdAt)],
		});
		return owner
			? { userId: owner.userId, organizationId: owner.organizationId }
			: null;
	},

	async findUserBySub(sub) {
		const linked = await db.query.account.findFirst({
			where: and(
				eq(account.providerId, KEYCLOAK_PROVIDER_ID),
				eq(account.accountId, sub),
			),
			with: { user: true },
		});
		return linked?.user
			? { id: linked.user.id, banned: !!linked.user.banned }
			: null;
	},

	async findUserByEmail(email) {
		// Emails are stored as typed at registration; Keycloak's are lowercased.
		const found = await db.query.user.findFirst({
			where: sql`lower(${user.email}) = ${email.toLowerCase()}`,
		});
		if (!found) return null;
		const link = await db.query.account.findFirst({
			where: and(
				eq(account.userId, found.id),
				eq(account.providerId, KEYCLOAK_PROVIDER_ID),
			),
		});
		return {
			id: found.id,
			banned: !!found.banned,
			linkedSub: link?.accountId ?? null,
		};
	},

	transaction(fn) {
		return db.transaction((tx) => fn(drizzleTx(tx)));
	},
};
