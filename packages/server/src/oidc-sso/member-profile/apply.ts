import { mergeProfiles } from "../domain/group-profiles";
import type { GroupProfile } from "../types";
import { resolveScope, type ScopeCatalog } from "./scope";
import type { MemberProfileStore } from "./store";

export type ApplyOutcome = "applied" | "revoked" | "none";

export interface ApplyGroupProfileInput {
	store: MemberProfileStore;
	catalog: ScopeCatalog;
	userId: string;
	organizationId: string;
	groups: string[];
	profiles: GroupProfile[];
	now: Date;
}

/**
 * Decision of spec 005 research R3, run on every SSO login after the role is
 * settled. Only members get a profile; admins and the owner lose a stale one;
 * custom roles and members that never had a profile are left untouched.
 */
export const applyGroupProfile = async ({
	store,
	catalog,
	userId,
	organizationId,
	groups,
	profiles,
	now,
}: ApplyGroupProfileInput): Promise<ApplyOutcome> => {
	if (profiles.length === 0) return "none";

	const role = await store.findRole(userId, organizationId);
	if (role === null) return "none";

	if (role === "owner" || role === "admin") {
		if (!(await store.findProfile(userId))) return "none";
		await store.revoke({ userId, organizationId });
		return "revoked";
	}
	if (role !== "member") return "none";

	const merged = mergeProfiles(profiles, groups);
	if (merged) {
		const scope = await resolveScope(merged.scopes, organizationId, catalog);
		await store.grant({
			userId,
			organizationId,
			groups: merged.groups,
			permissions: merged.permissions,
			scope,
			at: now,
		});
		return "applied";
	}

	if (!(await store.findProfile(userId))) return "none";
	await store.revoke({ userId, organizationId });
	return "revoked";
};
