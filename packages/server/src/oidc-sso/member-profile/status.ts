import { db } from "@dokploy/server/db";
import {
	oidcSsoLoginState,
	oidcSsoMemberProfile,
} from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { SSO_GRANT_TTL_MS } from "../domain/user-management";
import type { ReadOnlyScope } from "../types";
import type { ReadOnlySets } from "./cache";

export interface ProfileWithLogin {
	userId: string;
	organizationId: string;
	groups: string[];
	appliedAt: Date;
	expiredAt: Date | null;
	lastSsoLoginAt: Date | null;
}

export interface MemberProfileStatus {
	managed: boolean;
	groups: string[];
	expiresAt: string | null;
	expired: boolean;
	/** What the interface marks as read-only (spec 006, FR-010). */
	readOnly: ReadOnlyScope;
}

export const NO_READ_ONLY_STATUS: ReadOnlyScope = {
	environmentIds: [],
	serviceIds: [],
	projectIds: [],
};

export const readOnlyStatus = (sets: ReadOnlySets): ReadOnlyScope => ({
	environmentIds: [...sets.environmentIds],
	serviceIds: [...sets.serviceIds],
	projectIds: [...sets.projectIds],
});

export interface MemberProfileSummary {
	groups: string[];
	appliedAt: string;
	expired: boolean;
}

/**
 * Expired once the guard revoked it, or once 8 hours passed since the last
 * SSO login even if the guard has not run yet (spec 005, FR-017). With the
 * profiles switched off nothing expires, so only a real revocation counts.
 */
const isExpired = (row: ProfileWithLogin, now: Date, profilesActive: boolean) =>
	row.expiredAt !== null ||
	(profilesActive &&
		(!row.lastSsoLoginAt ||
			now.getTime() - row.lastSsoLoginAt.getTime() >= SSO_GRANT_TTL_MS));

export const toStatus = (
	row: ProfileWithLogin | null,
	now: Date,
	profilesActive = true,
): MemberProfileStatus => {
	if (!row) {
		return {
			managed: false,
			groups: [],
			expiresAt: null,
			expired: false,
			readOnly: NO_READ_ONLY_STATUS,
		};
	}
	return {
		managed: true,
		groups: row.groups,
		expiresAt: row.lastSsoLoginAt
			? new Date(row.lastSsoLoginAt.getTime() + SSO_GRANT_TTL_MS).toISOString()
			: null,
		expired: isExpired(row, now, profilesActive),
		readOnly: NO_READ_ONLY_STATUS,
	};
};

export const toSummaries = (
	rows: ProfileWithLogin[],
	now: Date,
	profilesActive = true,
): Record<string, MemberProfileSummary> =>
	Object.fromEntries(
		rows.map((row) => [
			row.userId,
			{
				groups: row.groups,
				appliedAt: row.appliedAt.toISOString(),
				expired: isExpired(row, now, profilesActive),
			},
		]),
	);

const selectProfiles = () =>
	db
		.select({
			userId: oidcSsoMemberProfile.userId,
			organizationId: oidcSsoMemberProfile.organizationId,
			groups: oidcSsoMemberProfile.groups,
			appliedAt: oidcSsoMemberProfile.appliedAt,
			expiredAt: oidcSsoMemberProfile.expiredAt,
			lastSsoLoginAt: oidcSsoLoginState.lastSsoLoginAt,
		})
		.from(oidcSsoMemberProfile)
		.leftJoin(
			oidcSsoLoginState,
			eq(oidcSsoLoginState.userId, oidcSsoMemberProfile.userId),
		);

export const findProfileWithLogin = async (
	userId: string,
): Promise<ProfileWithLogin | null> => {
	const [row] = await selectProfiles()
		.where(eq(oidcSsoMemberProfile.userId, userId))
		.limit(1);
	return row ?? null;
};

export const listProfilesWithLogin = (
	organizationId: string,
): Promise<ProfileWithLogin[]> =>
	selectProfiles().where(
		eq(oidcSsoMemberProfile.organizationId, organizationId),
	);
