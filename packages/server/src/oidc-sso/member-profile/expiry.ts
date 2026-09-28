import { db } from "@dokploy/server/db";
import { SSO_GRANT_TTL_MS } from "../domain/user-management";
import { newCorrelationId } from "../events/auth-events";
import type { OidcSsoServices } from "../services";
import { memberProfileCache } from "./cache";
import { findProfileWithLogin, type ProfileWithLogin } from "./status";
import {
	drizzleMemberProfileStore,
	listProfiledUserIds,
	type MemberProfileStore,
} from "./store";

export const MEMBER_PROFILE_EXPIRED_MESSAGE =
	"Your access expired. Sign in with SSO again.";

export interface MemberProfileExpiryDeps {
	services: Pick<OidcSsoServices, "config" | "events">;
	findRole(userId: string, organizationId: string): Promise<string | null>;
	findProfile(userId: string): Promise<ProfileWithLogin | null>;
	listProfiledUserIds(): Promise<string[]>;
	/** Runs the expiry writes in one transaction. */
	expire(fn: (store: MemberProfileStore) => Promise<void>): Promise<void>;
	now(): Date;
}

export type ExpiryResult =
	| { ok: true; outcome: "skipped" | "valid" | "expired" }
	| { ok: false };

/**
 * Lazy revocation of spec 005 FR-017 (research R6). The first request after
 * the 8 hours clears the member's permissions and scope in the database;
 * from then on upstream decides with nothing to grant. Owners, admins and
 * members outside the cache cost no query.
 */
export const checkMemberProfileExpiry = async (
	user: { id: string; role: string | null | undefined },
	deps: MemberProfileExpiryDeps,
): Promise<ExpiryResult> => {
	if (user.role !== "member") return { ok: true, outcome: "skipped" };
	try {
		const config = await deps.services.config.getEffective();
		if (!config.groupProfiles) return { ok: true, outcome: "skipped" };

		const now = deps.now();
		if (memberProfileCache.isStale(now.getTime())) {
			memberProfileCache.replace(
				await deps.listProfiledUserIds(),
				now.getTime(),
			);
		}
		if (!memberProfileCache.has(user.id)) {
			return { ok: true, outcome: "skipped" };
		}

		const profile = await deps.findProfile(user.id);
		if (!profile || profile.expiredAt) return { ok: true, outcome: "skipped" };
		if (
			profile.lastSsoLoginAt &&
			now.getTime() - profile.lastSsoLoginAt.getTime() < SSO_GRANT_TTL_MS
		) {
			return { ok: true, outcome: "valid" };
		}

		await deps.expire((store) =>
			store.expire({
				userId: user.id,
				organizationId: profile.organizationId,
				at: now,
			}),
		);
		await deps.services.events.record({
			type: "member_profile",
			outcome: "denied",
			reason: "profile_expired",
			userId: user.id,
			correlationId: newCorrelationId(),
		});
		return { ok: true, outcome: "expired" };
	} catch (error) {
		console.error("OIDC SSO: group profile expiry check failed", error);
		await deps.services.events.record({
			type: "member_profile",
			outcome: "error",
			reason: "check_failed",
			userId: user.id,
			correlationId: newCorrelationId(),
		});
		return { ok: false };
	}
};

export const defaultMemberProfileExpiryDeps = (
	services: MemberProfileExpiryDeps["services"],
): MemberProfileExpiryDeps => ({
	services,
	findRole: (userId, organizationId) =>
		drizzleMemberProfileStore().findRole(userId, organizationId),
	findProfile: findProfileWithLogin,
	listProfiledUserIds,
	expire: (fn) =>
		db.transaction((tx) => fn(drizzleMemberProfileStore(tx as never))),
	now: () => new Date(),
});

/**
 * For requests that do not go through tRPC, where the role is not in the
 * context (WebSocket upgrades). Everyone outside the cache skips without a
 * query, as in the tRPC guard.
 */
export const checkMemberProfileExpiryForUser = async (
	userId: string,
	organizationId: string,
	deps: MemberProfileExpiryDeps,
): Promise<ExpiryResult> => {
	const now = deps.now().getTime();
	if (!memberProfileCache.isStale(now) && !memberProfileCache.has(userId)) {
		return { ok: true, outcome: "skipped" };
	}
	try {
		const role = await deps.findRole(userId, organizationId);
		return checkMemberProfileExpiry({ id: userId, role }, deps);
	} catch (error) {
		console.error("OIDC SSO: group profile expiry check failed", error);
		return { ok: false };
	}
};
