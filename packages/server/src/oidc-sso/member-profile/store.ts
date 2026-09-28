import { db } from "@dokploy/server/db";
import { member, oidcSsoMemberProfile } from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";
import { MEMBER_PERMISSIONS, type MemberPermission } from "../types";
import { memberProfileCache } from "./cache";
import type { ResolvedScope } from "./scope";

export interface MemberProfileRow {
	groups: string[];
	appliedAt: Date;
	expiredAt: Date | null;
}

export interface MemberProfileStore {
	findRole(userId: string, organizationId: string): Promise<string | null>;
	findProfile(userId: string): Promise<MemberProfileRow | null>;
	grant(input: {
		userId: string;
		organizationId: string;
		groups: string[];
		permissions: MemberPermission[];
		scope: ResolvedScope;
		at: Date;
	}): Promise<void>;
	/** Clears flags and scope and deletes the row (FR-004). */
	revoke(input: { userId: string; organizationId: string }): Promise<void>;
	/** Clears flags and scope and keeps the row as expired (FR-017). */
	expire(input: {
		userId: string;
		organizationId: string;
		at: Date;
	}): Promise<void>;
}

const EMPTY_SCOPE: ResolvedScope = {
	projectIds: [],
	environmentIds: [],
	serviceIds: [],
};

// Only the columns a profile owns; role, accessedGitProviders and
// accessedServers stay whatever upstream or an admin set.
const memberColumns = (
	permissions: MemberPermission[],
	scope: ResolvedScope,
) => ({
	...Object.fromEntries(
		MEMBER_PERMISSIONS.map((name) => [name, permissions.includes(name)]),
	),
	accessedProjects: scope.projectIds,
	accessedEnvironments: scope.environmentIds,
	accessedServices: scope.serviceIds,
});

type Writer = Pick<typeof db, "select" | "update" | "insert" | "delete">;

export const drizzleMemberProfileStore = (
	writer: Writer = db,
): MemberProfileStore => ({
	async findRole(userId, organizationId) {
		const [row] = await writer
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
				),
			)
			.limit(1);
		return row?.role ?? null;
	},

	async findProfile(userId) {
		const [row] = await writer
			.select({
				groups: oidcSsoMemberProfile.groups,
				appliedAt: oidcSsoMemberProfile.appliedAt,
				expiredAt: oidcSsoMemberProfile.expiredAt,
			})
			.from(oidcSsoMemberProfile)
			.where(eq(oidcSsoMemberProfile.userId, userId))
			.limit(1);
		return row ?? null;
	},

	async grant({ userId, organizationId, groups, permissions, scope, at }) {
		memberProfileCache.add(userId);
		await writer
			.update(member)
			.set(memberColumns(permissions, scope))
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
				),
			);
		await writer
			.insert(oidcSsoMemberProfile)
			.values({
				userId,
				organizationId,
				groups,
				appliedAt: at,
				expiredAt: null,
				updatedAt: at,
			})
			.onConflictDoUpdate({
				target: oidcSsoMemberProfile.userId,
				set: {
					organizationId,
					groups,
					appliedAt: at,
					expiredAt: null,
					updatedAt: at,
				},
			});
	},

	async revoke({ userId, organizationId }) {
		await writer
			.update(member)
			.set(memberColumns([], EMPTY_SCOPE))
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
				),
			);
		await writer
			.delete(oidcSsoMemberProfile)
			.where(eq(oidcSsoMemberProfile.userId, userId));
	},

	async expire({ userId, organizationId, at }) {
		await writer
			.update(member)
			.set(memberColumns([], EMPTY_SCOPE))
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
				),
			);
		await writer
			.update(oidcSsoMemberProfile)
			.set({ expiredAt: at, updatedAt: at })
			.where(eq(oidcSsoMemberProfile.userId, userId));
	},
});

/** Users with a profile row, to reload the expiry cache (research R6). */
export const listProfiledUserIds = async (): Promise<string[]> => {
	const rows = await db
		.select({ userId: oidcSsoMemberProfile.userId })
		.from(oidcSsoMemberProfile);
	return rows.map((row) => row.userId);
};
