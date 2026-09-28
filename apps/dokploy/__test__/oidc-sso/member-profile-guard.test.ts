import { describe, expect, it, vi } from "vitest";
import { createMemberProfileGuard } from "@/server/api/middlewares/member-profile";

vi.mock("@dokploy/server/oidc-sso/member-profile/expiry", async (original) => ({
	...(await original<object>()),
	checkMemberProfileExpiry: vi.fn(async (user: { id: string }) =>
		user.id === "broken" ? { ok: false } : { ok: true, outcome: "valid" },
	),
}));

const guard = createMemberProfileGuard(() => ({}) as never);

describe("memberProfileGuard (spec 005, contracts/trpc-and-guard.md)", () => {
	it("lets non-members through without checking", async () => {
		const next = vi.fn(async () => "ok");
		await expect(
			guard({ ctx: { user: { id: "a", role: "admin" } }, next }),
		).resolves.toBe("ok");
		await expect(guard({ ctx: { user: null }, next })).resolves.toBe("ok");
	});

	it("lets a member through when the check passes", async () => {
		const next = vi.fn(async () => "ok");
		await expect(
			guard({ ctx: { user: { id: "dev", role: "member" } }, next }),
		).resolves.toBe("ok");
	});

	it("NFR-SEC-001: denies with FORBIDDEN when the check fails", async () => {
		const next = vi.fn(async () => "ok");
		await expect(
			guard({ ctx: { user: { id: "broken", role: "member" } }, next }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Your access expired. Sign in with SSO again.",
		});
		expect(next).not.toHaveBeenCalled();
	});
});
