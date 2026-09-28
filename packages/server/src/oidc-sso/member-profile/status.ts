import { db } from "@dokploy/server/db";
import {
	oidcSsoLoginState,
	oidcSsoMemberProfile,
} from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { SSO_GRANT_TTL_MS } from "../domain/user-management";

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
}

export interface MemberProfileSummary {
	groups: string[];
	appliedAt: string;
	expired: boolean;
}

/**
 * Expired once the guard revoked it, or once 8 hours passed since the last
 * SSO login even if the guard has not run yet (spec 005, FR-017).
 */
const isExpired = (row: ProfileWithLogin, now: Date) =>
	row.expiredAt !== null ||
	!row.lastSsoLoginAt ||
	now.getTime() - row.lastSsoLoginAt.getTime() >= SSO_GRANT_TTL_MS;

export const toStatus = (
	row: ProfileWithLogin | null,
	now: Date,
): MemberProfileStatus => {
	if (!row) {
		return { managed: false, groups: [], expiresAt: null, expired: false };
	}
	return {
		managed: true,
		groups: row.groups,
		expiresAt: row.lastSsoLoginAt
			? new Date(row.lastSsoLoginAt.getTime() + SSO_GRANT_TTL_MS).toISOString()
			: null,
		expired: isExpired(row, now),
	};
};

export const toSummaries = (
	rows: ProfileWithLogin[],
	now: Date,
): Record<string, MemberProfileSummary> =>
	Object.fromEntries(
		rows.map((row) => [
			row.userId,
			{
				groups: row.groups,
				appliedAt: row.appliedAt.toISOString(),
				expired: isExpired(row, now),
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
