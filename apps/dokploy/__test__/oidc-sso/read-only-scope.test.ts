import { memberProfileCache } from "@dokploy/server/oidc-sso/member-profile/cache";
import {
	getReadOnlyScope,
	isReadOnlyEmpty,
	type ReadOnlyScopeSource,
	readOnlyScopeCache,
} from "@dokploy/server/oidc-sso/member-profile/read-only-scope";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DEV = {
	userId: "dev",
	environmentIds: ["e-prod"],
	serviceIds: ["s-prod"],
	projectIds: ["p1"],
};

const source = (
	rows = [DEV],
): ReadOnlyScopeSource & {
	find: ReturnType<typeof vi.fn>;
	list: ReturnType<typeof vi.fn>;
} => ({
	find: vi.fn(async (userId: string) => {
		const row = rows.find((r) => r.userId === userId);
		if (!row) return null;
		const { userId: _ignored, ...scope } = row;
		return scope;
	}),
	list: vi.fn(async () => rows),
});

beforeEach(() => {
	readOnlyScopeCache.reset();
	memberProfileCache.reset();
});

describe("getReadOnlyScope (spec 006, FR-008, NFR-PERF-001, NFR-SEC-001)", () => {
	it("loads every row once and then answers from memory", async () => {
		const s = source();
		const first = await getReadOnlyScope("dev", s, 1_000);
		const second = await getReadOnlyScope("dev", s, 2_000);
		expect([...first.environmentIds]).toEqual(["e-prod"]);
		expect(second).toBe(first);
		expect(s.list).toHaveBeenCalledTimes(1);
		expect(s.find).not.toHaveBeenCalled();
	});

	it("reloads everything after 5 minutes", async () => {
		const s = source();
		await getReadOnlyScope("dev", s, 0);
		await getReadOnlyScope("dev", s, 5 * 60 * 1000);
		expect(s.list).toHaveBeenCalledTimes(2);
	});

	it("reads one row after an invalidation instead of trusting memory", async () => {
		const s = source();
		await getReadOnlyScope("dev", s, 0);
		readOnlyScopeCache.invalidate("dev");
		await getReadOnlyScope("dev", s, 1);
		expect(s.find).toHaveBeenCalledWith("dev");
		expect(s.list).toHaveBeenCalledTimes(1);
	});

	it("a row read before an invalidation serves that call but is not kept", async () => {
		const s = source();
		await getReadOnlyScope("dev", s, 0);
		readOnlyScopeCache.invalidate("dev");
		let release: () => void = () => {};
		s.find.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { environmentIds: [], serviceIds: [], projectIds: [] };
		});
		const pending = getReadOnlyScope("dev", s, 1);
		await vi.waitFor(() => expect(s.find).toHaveBeenCalledTimes(1));
		readOnlyScopeCache.invalidate("dev");
		release();
		expect(isReadOnlyEmpty(await pending)).toBe(true);

		const next = await getReadOnlyScope("dev", s, 2);
		expect([...next.environmentIds]).toEqual(["e-prod"]);
		expect(s.find).toHaveBeenCalledTimes(2);
	});

	it("a reload that overlaps an invalidation is not kept", async () => {
		const s = source();
		let release: () => void = () => {};
		s.list.mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return [{ ...DEV, environmentIds: [] }];
		});
		const pending = getReadOnlyScope("dev", s, 0);
		await vi.waitFor(() => expect(s.list).toHaveBeenCalledTimes(1));
		readOnlyScopeCache.invalidate("dev");
		release();
		await pending;

		const next = await getReadOnlyScope("dev", s, 1);
		expect([...next.environmentIds]).toEqual(["e-prod"]);
		expect(s.list).toHaveBeenCalledTimes(2);
	});

	it("another copy of the module, as in another bundle, shares both caches", async () => {
		vi.resetModules();
		const copy = await import(
			"@dokploy/server/oidc-sso/member-profile/cache"
		);
		expect(copy.readOnlyScopeCache).not.toBe(readOnlyScopeCache);

		const s = source();
		await getReadOnlyScope("dev", s, 0);
		copy.readOnlyScopeCache.invalidate("dev");
		expect(readOnlyScopeCache.get("dev")).toBeUndefined();

		copy.memberProfileCache.add("new-dev");
		expect(memberProfileCache.has("new-dev")).toBe(true);
	});

	it("a user without a row has an empty scope", async () => {
		const scope = await getReadOnlyScope("other", source(), 0);
		expect(isReadOnlyEmpty(scope)).toBe(true);
	});

	it("NFR-SEC-001: a read error is thrown, never an empty scope", async () => {
		const s = source();
		s.list.mockRejectedValueOnce(new Error("db down"));
		await expect(getReadOnlyScope("dev", s, 0)).rejects.toThrow("db down");
	});
});

describe("no readOnly configured costs nothing per request (spec 006, US5-1, FR-012, NFR-PERF-001)", () => {
	it("after the first load, 100 guard checks read nothing more", async () => {
		const { checkReadOnlyCall } = await import(
			"@dokploy/server/oidc-sso/read-only/guard"
		);
		const s = source([
			{ userId: "dev", environmentIds: [], serviceIds: [], projectIds: [] },
		]);
		const deps = {
			isProfiled: () => true,
			getScope: (userId: string) => getReadOnlyScope(userId, s, 1_000),
			ownerOf: vi.fn(async () => null),
			record: vi.fn(async () => {}),
		};
		for (let i = 0; i < 100; i++) {
			await expect(
				checkReadOnlyCall(
					{
						user: { id: "dev", role: "member" },
						path: "application.deploy",
						type: "mutation",
						getRawInput: async () => ({ applicationId: "app" }),
					},
					deps,
				),
			).resolves.toEqual({ kind: "pass" });
		}
		expect(s.list).toHaveBeenCalledTimes(1);
		expect(s.find).not.toHaveBeenCalled();
		expect(deps.ownerOf).not.toHaveBeenCalled();
		expect(deps.record).not.toHaveBeenCalled();
	});
});
