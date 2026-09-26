import { db } from "@dokploy/server/db";
import { oidcSsoLoginState } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { normalizeGroup } from "../domain/claims";
import type { LoginState } from "../domain/user-management";

export const LOGIN_STATE_MAX_GROUPS = 100;
export const LOGIN_STATE_MAX_GROUP_LENGTH = 256;

/**
 * Bounded so a provider sending huge group lists cannot grow the row without
 * limit. A group dropped here simply does not match, which fails closed.
 */
export const normalizeLoginGroups = (groups: string[]): string[] =>
	[...new Set(groups.map(normalizeGroup))]
		.filter(
			(group) =>
				group.length > 0 && group.length <= LOGIN_STATE_MAX_GROUP_LENGTH,
		)
		.sort()
		.slice(0, LOGIN_STATE_MAX_GROUPS);

type Writer = Pick<typeof db, "insert">;

export interface LoginStateStore {
	find(userId: string): Promise<LoginState | null>;
	upsert(
		writer: Writer,
		input: { userId: string; groups: string[]; at: Date },
	): Promise<void>;
}

export const drizzleLoginStateStore: LoginStateStore = {
	async find(userId) {
		const row = await db.query.oidcSsoLoginState.findFirst({
			where: eq(oidcSsoLoginState.userId, userId),
		});
		return row
			? { groups: row.groups, lastSsoLoginAt: row.lastSsoLoginAt }
			: null;
	},

	async upsert(writer, { userId, groups, at }) {
		await writer
			.insert(oidcSsoLoginState)
			.values({ userId, groups, lastSsoLoginAt: at, updatedAt: at })
			.onConflictDoUpdate({
				target: oidcSsoLoginState.userId,
				set: { groups, lastSsoLoginAt: at, updatedAt: at },
			});
	},
};
