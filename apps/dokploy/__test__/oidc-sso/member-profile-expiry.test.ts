import { SSO_GRANT_TTL_MS } from "@dokploy/server/oidc-sso/domain/user-management";
import { memberProfileCache } from "@dokploy/server/oidc-sso/member-profile/cache";
import {
	checkMemberProfileExpiry,
	type MemberProfileExpiryDeps,
} from "@dokploy/server/oidc-sso/member-profile/expiry";
import type { ProfileWithLogin } from "@dokploy/server/oidc-sso/member-profile/status";
import type { MemberProfileStore } from "@dokploy/server/oidc-sso/member-profile/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeConfig, makeServices } from "./helpers";

const NOW = new Date("2026-09-28T20:00:00Z");
const profiles = JSON.stringify({
	developers: { permissions: [], projects: ["alpha"] },
});

const row = (lastSsoLoginAt: Date | null, expiredAt: Date | null = null) =>
	({
		userId: "dev-1",
		organizationId: "org",
		groups: ["developers"],
		appliedAt: lastSsoLoginAt ?? NOW,
		expiredAt,
		lastSsoLoginAt,
	}) satisfies ProfileWithLogin;

const build = ({
	groupProfiles = profiles as string | null,
	profile = row(new Date(NOW.getTime() - 60_000)) as ProfileWithLogin | null,
	profiledIds = ["dev-1"],
} = {}) => {
	const { services, recorded } = makeServices({
		config: { ...activeConfig, groupProfiles },
	});
	const store = { expire: vi.fn(async () => {}) };
	const deps: MemberProfileExpiryDeps & {
		findProfile: ReturnType<typeof vi.fn>;
		listProfiledUserIds: ReturnType<typeof vi.fn>;
	} = {
		services,
		findProfile: vi.fn(async () => profile),
		listProfiledUserIds: vi.fn(async () => profiledIds),
		expire: vi.fn(async (fn) => fn(store as unknown as MemberProfileStore)),
		now: () => NOW,
	};
	return { deps, store, recorded };
};

const member = { id: "dev-1", role: "member" };

beforeEach(() => memberProfileCache.reset());

describe("checkMemberProfileExpiry (spec 005, FR-017, contracts/trpc-and-guard.md)", () => {
	it.each(["owner", "admin", undefined])(
		"exit 1: %s is skipped without any read",
		async (role) => {
			const { deps } = build();
			await expect(
				checkMemberProfileExpiry({ id: "u", role }, deps),
			).resolves.toEqual({ ok: true, outcome: "skipped" });
			expect(deps.listProfiledUserIds).not.toHaveBeenCalled();
			expect(deps.findProfile).not.toHaveBeenCalled();
		},
	);

	it("exit 2: a member outside the cache is skipped without reading its profile", async () => {
		const { deps } = build({ profiledIds: ["someone-else"] });
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "skipped",
		});
		expect(deps.findProfile).not.toHaveBeenCalled();
	});

	it("exit 3: a profile within 8 hours of the last SSO login passes", async () => {
		const { deps, store } = build();
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "valid",
		});
		expect(store.expire).not.toHaveBeenCalled();
	});

	it("exit 4: after 8 hours the profile is expired in a transaction and recorded", async () => {
		const { deps, store, recorded } = build({
			profile: row(new Date(NOW.getTime() - SSO_GRANT_TTL_MS)),
		});
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "expired",
		});
		expect(deps.expire).toHaveBeenCalledTimes(1);
		expect(store.expire).toHaveBeenCalledWith({
			userId: "dev-1",
			organizationId: "org",
			at: NOW,
		});
		expect(recorded).toEqual([
			expect.objectContaining({
				type: "member_profile",
				outcome: "denied",
				reason: "profile_expired",
				userId: "dev-1",
			}),
		]);
	});

	it("a profile already expired is not expired again", async () => {
		const { deps, store, recorded } = build({
			profile: row(new Date(NOW.getTime() - 2 * SSO_GRANT_TTL_MS), NOW),
		});
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "skipped",
		});
		expect(store.expire).not.toHaveBeenCalled();
		expect(recorded).toEqual([]);
	});

	it("exit 5: an error fails closed and is recorded", async () => {
		const { deps, recorded } = build();
		deps.findProfile.mockRejectedValueOnce(new Error("db down"));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: false,
		});
		expect(recorded).toEqual([
			expect.objectContaining({
				type: "member_profile",
				outcome: "error",
				reason: "check_failed",
			}),
		]);
		errors.mockRestore();
	});

	it("loads the cache once and reuses it until it goes stale", async () => {
		const { deps } = build();
		await checkMemberProfileExpiry(member, deps);
		await checkMemberProfileExpiry(member, deps);
		expect(deps.listProfiledUserIds).toHaveBeenCalledTimes(1);
	});

	it("keeps a user added by a grant even before the next reload", async () => {
		const { deps } = build({ profiledIds: [] });
		await checkMemberProfileExpiry(member, deps);
		memberProfileCache.add("dev-1");
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "valid",
		});
	});

	it("FR-013/US5: without group profiles configured nothing is read", async () => {
		const { deps } = build({ groupProfiles: null });
		await expect(checkMemberProfileExpiry(member, deps)).resolves.toEqual({
			ok: true,
			outcome: "skipped",
		});
		expect(deps.listProfiledUserIds).not.toHaveBeenCalled();
		expect(deps.findProfile).not.toHaveBeenCalled();
	});
});
