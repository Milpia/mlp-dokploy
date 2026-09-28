import { applyGroupProfile } from "@dokploy/server/oidc-sso/member-profile/apply";
import type { ScopeCatalog } from "@dokploy/server/oidc-sso/member-profile/scope";
import type {
	MemberProfileRow,
	MemberProfileStore,
} from "@dokploy/server/oidc-sso/member-profile/store";
import type { GroupProfile } from "@dokploy/server/oidc-sso/types";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-28T12:00:00Z");

const developers: GroupProfile = {
	group: "developers",
	permissions: ["canCreateServices"],
	projects: ["alpha"],
	environments: { exclude: ["production"] },
};

const catalog: ScopeCatalog = {
	projectsByName: vi.fn(async () => [{ projectId: "p-alpha", name: "alpha" }]),
	environmentsOf: vi.fn(async () => [
		{ environmentId: "e-prod", projectId: "p-alpha", name: "production" },
		{ environmentId: "e-staging", projectId: "p-alpha", name: "staging" },
	]),
	servicesOf: vi.fn(async () => ["s-app"]),
};

const store = (
	role: string | null,
	profile: MemberProfileRow | null = null,
): MemberProfileStore & {
	grant: ReturnType<typeof vi.fn>;
	revoke: ReturnType<typeof vi.fn>;
	expire: ReturnType<typeof vi.fn>;
} => ({
	findRole: vi.fn(async () => role),
	findProfile: vi.fn(async () => profile),
	grant: vi.fn(async () => {}),
	revoke: vi.fn(async () => {}),
	expire: vi.fn(async () => {}),
});

const existingProfile: MemberProfileRow = {
	groups: ["developers"],
	appliedAt: new Date("2026-09-27T12:00:00Z"),
	expiredAt: null,
};

const apply = (
	s: MemberProfileStore,
	groups: string[],
	profiles: GroupProfile[] = [developers],
) =>
	applyGroupProfile({
		store: s,
		catalog,
		userId: "u1",
		organizationId: "org",
		groups,
		profiles,
		now: NOW,
	});

describe("applyGroupProfile (spec 005, research R3 and R8)", () => {
	it("FR-003: a member of a profiled group gets its permissions and scope", async () => {
		const s = store("member");
		await expect(apply(s, ["developers"])).resolves.toBe("applied");
		expect(s.grant).toHaveBeenCalledWith({
			userId: "u1",
			organizationId: "org",
			groups: ["developers"],
			permissions: ["canCreateServices"],
			scope: {
				projectIds: ["p-alpha"],
				environmentIds: ["e-staging"],
				serviceIds: ["s-app"],
			},
			at: NOW,
		});
		expect(s.revoke).not.toHaveBeenCalled();
	});

	it("FR-003: a later login overwrites an existing profile", async () => {
		const s = store("member", existingProfile);
		await expect(apply(s, ["developers"])).resolves.toBe("applied");
		expect(s.grant).toHaveBeenCalledTimes(1);
	});

	it("FR-004: a member who left every profiled group is revoked", async () => {
		const s = store("member", existingProfile);
		await expect(apply(s, ["others"])).resolves.toBe("revoked");
		expect(s.revoke).toHaveBeenCalledWith({
			userId: "u1",
			organizationId: "org",
		});
		expect(s.grant).not.toHaveBeenCalled();
	});

	it("FR-005: a member without a profile and outside the groups is untouched", async () => {
		const s = store("member", null);
		await expect(apply(s, ["others"])).resolves.toBe("none");
		expect(s.grant).not.toHaveBeenCalled();
		expect(s.revoke).not.toHaveBeenCalled();
	});

	it.each(["admin", "owner"])(
		"FR-007: a %s with a stale profile loses it",
		async (role) => {
			const s = store(role, existingProfile);
			await expect(apply(s, ["developers"])).resolves.toBe("revoked");
			expect(s.grant).not.toHaveBeenCalled();
		},
	);

	it("FR-007: an admin without a profile is untouched", async () => {
		const s = store("admin", null);
		await expect(apply(s, ["developers"])).resolves.toBe("none");
		expect(s.revoke).not.toHaveBeenCalled();
	});

	it("FR-014: a custom role is never touched", async () => {
		const s = store("deployer", existingProfile);
		await expect(apply(s, ["developers"])).resolves.toBe("none");
		expect(s.grant).not.toHaveBeenCalled();
		expect(s.revoke).not.toHaveBeenCalled();
	});

	it("FR-013: without configured profiles nothing is read or written", async () => {
		const s = store("member", existingProfile);
		await expect(apply(s, ["developers"], [])).resolves.toBe("none");
		expect(s.findRole).not.toHaveBeenCalled();
		expect(s.grant).not.toHaveBeenCalled();
		expect(s.revoke).not.toHaveBeenCalled();
	});

	it("does nothing when the membership does not exist", async () => {
		const s = store(null);
		await expect(apply(s, ["developers"])).resolves.toBe("none");
	});
});
