import {
	MEMBER_NETWORK_DENIED_MESSAGE,
	type MemberNetworkGuardDeps,
	NETWORK_READS,
} from "@dokploy/server/oidc-sso/member-profile/network-guard";
import { describe, expect, it, vi } from "vitest";
import {
	createMemberNetworkGuard,
	memberNetworkGuard,
} from "@/server/api/middlewares/member-network";
import { appRouter } from "@/server/api/root";

type Procedures = Record<
	string,
	{ _def: { type: string; middlewares: unknown[] } }
>;

const procedures = (): Procedures =>
	(appRouter as unknown as { _def: { procedures: Procedures } })._def
		.procedures;

const networkPaths = (type: "query" | "mutation") =>
	Object.entries(procedures())
		.filter(([path, p]) => path.startsWith("network.") && p._def.type === type)
		.map(([path]) => path)
		.sort();

const deps = (overrides: Partial<MemberNetworkGuardDeps> = {}) => ({
	isSsoActive: vi.fn(async () => true),
	record: vi.fn(async () => {}),
	...overrides,
});

const call = async (
	d: ReturnType<typeof deps>,
	path: string,
	type: string,
	user: { id: string; role: string } | null = { id: "dev-1", role: "member" },
) => {
	const next = vi.fn(async () => "ok");
	const result = createMemberNetworkGuard(() => d)({
		ctx: { user },
		path,
		type,
		next,
	});
	return { result, next };
};

describe("memberNetworkGuard (spec 005, FR-018)", () => {
	it.each(networkPaths("mutation"))("denies %s to a member", async (path) => {
		const d = deps();
		const { result, next } = await call(d, path, "mutation");
		await expect(result).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: MEMBER_NETWORK_DENIED_MESSAGE,
		});
		expect(next).not.toHaveBeenCalled();
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "member_profile",
				outcome: "denied",
				reason: "network_change",
				userId: "dev-1",
				action: path,
			}),
		);
	});

	it.each(networkPaths("query"))("lets a member read %s", async (path) => {
		const d = deps();
		const { result } = await call(d, path, "query");
		await expect(result).resolves.toBe("ok");
		expect(d.isSsoActive).not.toHaveBeenCalled();
		expect(d.record).not.toHaveBeenCalled();
	});

	it.each(["owner", "admin"])("leaves %s untouched", async (role) => {
		const d = deps();
		const { result } = await call(d, "network.remove", "mutation", {
			id: "boss",
			role,
		});
		await expect(result).resolves.toBe("ok");
		expect(d.isSsoActive).not.toHaveBeenCalled();
	});

	it("behaves as upstream while the SSO is disabled", async () => {
		const d = deps({ isSsoActive: vi.fn(async () => false) });
		const { result } = await call(d, "network.remove", "mutation");
		await expect(result).resolves.toBe("ok");
		expect(d.record).not.toHaveBeenCalled();
	});

	it("does not look at anything outside the network router", async () => {
		const d = deps();
		const { result } = await call(d, "application.deploy", "mutation");
		await expect(result).resolves.toBe("ok");
		expect(d.isSsoActive).not.toHaveBeenCalled();
	});

	it("NFR-SEC-001: denies when the configuration cannot be read", async () => {
		const d = deps({
			isSsoActive: vi.fn(async () => {
				throw new Error("database is down");
			}),
		});
		const { result, next } = await call(d, "network.create", "mutation");
		await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(next).not.toHaveBeenCalled();
	});

	it("still denies when the event cannot be recorded", async () => {
		const d = deps({
			record: vi.fn(async () => {
				throw new Error("events table is locked");
			}),
		});
		const { result } = await call(d, "network.remove", "mutation");
		await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// A sync with upstream must not drop the guard, nor add a network procedure
// that changes something behind a query nobody reviewed.
describe("memberNetworkGuard covers the upstream network router (FR-018)", () => {
	it("runs on every network procedure", () => {
		const unguarded = Object.entries(procedures())
			.filter(([path]) => path.startsWith("network."))
			.filter(([, p]) => !p._def.middlewares.includes(memberNetworkGuard))
			.map(([path]) => path);
		expect(unguarded).toEqual([]);
	});

	it("knows every network query as a read", () => {
		expect(networkPaths("query")).toEqual([...NETWORK_READS].sort());
	});

	it("still finds the five mutations it was written for", () => {
		expect(networkPaths("mutation")).toEqual([
			"network.create",
			"network.import",
			"network.recreate",
			"network.remove",
			"network.resync",
		]);
	});
});
