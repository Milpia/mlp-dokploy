import { USER_MANAGEMENT_GRANT_TTL_MS } from "@dokploy/server/oidc-sso/domain/user-management";
import type { UserManagementGuardDeps } from "@dokploy/server/oidc-sso/user-management/guard";
import { TRPC_USER_MANAGEMENT_PATHS } from "@dokploy/server/oidc-sso/user-management/paths";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createUserManagementGuard } from "@/server/api/middlewares/user-management";
import { activeConfig, makeServices } from "./helpers";

const NOW = new Date("2026-09-26T12:00:00Z");

type Ctx = {
	user: { id: string };
	req?: { headers: Record<string, unknown> };
};

const setup = (
	loginState: { groups: string[]; lastSsoLoginAt: Date } | null = {
		groups: ["leads"],
		lastSsoLoginAt: NOW,
	},
	group: string | null = "admins",
	{ userId = "lead-1", now = NOW } = {},
) => {
	const built = makeServices({
		config: { ...activeConfig, userManagementGroup: group },
	});
	const deps: UserManagementGuardDeps = {
		services: built.services,
		loginState: { find: vi.fn(async () => loginState) },
		resolveTarget: vi.fn(async (ref) => ref.userId ?? null),
		now: () => now,
		logError: vi.fn(),
	};
	const t = initTRPC.context<Ctx>().create();
	const procedure = t.procedure.use(createUserManagementGuard(() => deps));
	const handler = vi.fn(async ({ path }: { path: string }) => {
		// Stands in for upstream's own hierarchy check on updateMemberRole.
		if (path === "organization.updateMemberRole") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only the owner can change an admin's role",
			});
		}
		return "handled";
	});
	const leaf = procedure
		.input(z.object({ userId: z.string().optional() }).optional())
		.mutation(handler);
	const router = t.router({
		user: t.router({
			remove: leaf,
			assignPermissions: leaf,
			createUserWithCredentials: leaf,
			sendInvitation: leaf,
		}),
		organization: t.router({
			inviteMember: leaf,
			removeInvitation: leaf,
			updateMemberRole: leaf,
		}),
		customRole: t.router({ create: leaf, update: leaf, remove: leaf }),
		project: t.router({ create: leaf }),
	});
	const caller = t.createCallerFactory(router)({
		user: { id: userId },
		req: { headers: { "x-forwarded-for": "10.0.0.9" } },
	});
	return { ...built, deps, handler, caller };
};

const call = (
	caller: ReturnType<typeof setup>["caller"],
	path: string,
	input?: unknown,
) => {
	const [group, name] = path.split(".") as [string, string];
	// biome-ignore lint/suspicious/noExplicitAny: dynamic path dispatch in a test
	return (caller as any)[group][name](input);
};

describe("tRPC user-management guard (spec 002)", () => {
	it.each([...TRPC_USER_MANAGEMENT_PATHS.keys()])(
		"FR-004/FR-006: %s is FORBIDDEN for a lead and the handler never runs",
		async (path) => {
			const { caller, handler } = setup();
			await expect(call(caller, path, { userId: "dev-1" })).rejects.toSatisfy(
				(error: unknown) =>
					error instanceof TRPCError && error.code === "FORBIDDEN",
			);
			expect(handler).not.toHaveBeenCalled();
		},
	);

	it("FR-012: records the denial with action, target and IP", async () => {
		const { caller, recorded } = setup();
		await expect(
			call(caller, "user.remove", { userId: "dev-1" }),
		).rejects.toBeInstanceOf(TRPCError);
		expect(recorded[0]).toMatchObject({
			type: "user_management",
			userId: "lead-1",
			action: "remove_user",
			targetUserId: "dev-1",
			ip: "10.0.0.9",
		});
	});

	it("FR-005/NFR-PERF-001: other procedures run with no config or DB read", async () => {
		const { caller, handler, deps } = setup();
		const getEffective = vi.spyOn(deps.services.config, "getEffective");
		await expect(call(caller, "project.create")).resolves.toBe("handled");
		expect(handler).toHaveBeenCalledTimes(1);
		expect(getEffective).not.toHaveBeenCalled();
		expect(deps.loginState.find).not.toHaveBeenCalled();
	});

	it("FR-003: an admin of the user-management group reaches the handler", async () => {
		const { caller, handler } = setup({
			groups: ["admins"],
			lastSsoLoginAt: NOW,
		});
		await expect(
			call(caller, "user.remove", { userId: "dev-1" }),
		).resolves.toBe("handled");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("FR-009: without a configured group every path is left to upstream", async () => {
		const { caller, handler } = setup(null, null);
		await expect(call(caller, "user.remove")).resolves.toBe("handled");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("FR-006: the FORBIDDEN message is the contract message", async () => {
		const { caller } = setup(null);
		await expect(
			call(caller, "organization.inviteMember"),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Sign in with SSO to manage users.",
		});
	});

	it("FR-003/FR-015: an admin with an SSO login under 8 h ago reaches the handler", async () => {
		const { caller, handler } = setup({
			groups: ["admins"],
			lastSsoLoginAt: new Date(
				NOW.getTime() - USER_MANAGEMENT_GRANT_TTL_MS + 1,
			),
		});
		await expect(call(caller, "user.assignPermissions")).resolves.toBe(
			"handled",
		);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("FR-010: the owner reaches the handler with no login state", async () => {
		const { caller, handler, deps } = setup(null, "admins", {
			userId: "owner-id",
		});
		deps.services.instanceOwnerId = vi.fn(async () => "owner-id");
		await expect(
			call(caller, "user.remove", { userId: "dev-1" }),
		).resolves.toBe("handled");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("FR-011: an allowed admin still gets upstream's own FORBIDDEN", async () => {
		const { caller, handler, recorded } = setup({
			groups: ["admins"],
			lastSsoLoginAt: NOW,
		});
		await expect(
			call(caller, "organization.updateMemberRole"),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change an admin's role",
		});
		expect(handler).toHaveBeenCalledTimes(1);
		expect(recorded).toHaveLength(0);
	});

	it("FR-015: after 8 h the same admin gets grant_expired", async () => {
		const { caller, handler } = setup(
			{ groups: ["admins"], lastSsoLoginAt: NOW },
			"admins",
			{ now: new Date(NOW.getTime() + USER_MANAGEMENT_GRANT_TTL_MS) },
		);
		await expect(call(caller, "user.remove")).rejects.toMatchObject({
			code: "FORBIDDEN",
			message:
				"Your permission to manage users expired. Sign in with SSO again.",
		});
		expect(handler).not.toHaveBeenCalled();
	});
});
