import { USER_MANAGEMENT_GRANT_TTL_MS } from "@dokploy/server/oidc-sso/domain/user-management";
import {
	checkUserManagement,
	getUserManagementStatus,
	USER_MANAGEMENT_MESSAGES,
	type UserManagementGuardDeps,
} from "@dokploy/server/oidc-sso/user-management/guard";
import { describe, expect, it, vi } from "vitest";
import { activeConfig, makeServices } from "./helpers";

const NOW = new Date("2026-09-26T12:00:00Z");

const setup = async ({
	group = "admins" as string | null,
	loginState = {
		groups: ["leads"],
		lastSsoLoginAt: new Date(NOW.getTime() - 60_000),
	} as { groups: string[]; lastSsoLoginAt: Date } | null,
	ownerId = "owner-id",
} = {}) => {
	const built = makeServices({
		config: { ...activeConfig, userManagementGroup: group },
	});
	built.services.instanceOwnerId = vi.fn(async () => ownerId);
	const deps: UserManagementGuardDeps = {
		services: built.services,
		loginState: { find: vi.fn(async () => loginState) },
		resolveTarget: vi.fn(async (ref) => ref.userId ?? "resolved-user"),
		now: () => NOW,
		logError: vi.fn(),
	};
	return { ...built, deps };
};

describe("checkUserManagement (spec 002)", () => {
	it("FR-006/FR-012: denies a lead and records the attempt with action and target", async () => {
		const { deps, recorded } = await setup();
		const result = await checkUserManagement(deps, {
			userId: "lead-1",
			action: "remove_user",
			target: { userId: "dev-1" },
			ip: "10.0.0.1",
		});
		expect(result).toEqual({
			allow: false,
			reason: "not_in_group",
			message: USER_MANAGEMENT_MESSAGES.not_in_group,
		});
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			type: "user_management",
			outcome: "denied",
			reason: "not_in_group",
			userId: "lead-1",
			action: "remove_user",
			targetUserId: "dev-1",
			ip: "10.0.0.1",
		});
	});

	it.each<
		[
			"no_sso_login" | "grant_expired",
			{ groups: string[]; lastSsoLoginAt: Date } | null,
		]
	>([
		["no_sso_login", null],
		[
			"grant_expired",
			{
				groups: ["admins"],
				lastSsoLoginAt: new Date(NOW.getTime() - USER_MANAGEMENT_GRANT_TTL_MS),
			},
		],
	])(
		"FR-014/FR-015: denies with the %s message",
		async (reason, loginState) => {
			const { deps } = await setup({ loginState });
			await expect(
				checkUserManagement(deps, { userId: "admin-1", action: "invite" }),
			).resolves.toEqual({
				allow: false,
				reason,
				message: USER_MANAGEMENT_MESSAGES[reason],
			});
		},
	);

	it("FR-003: allows an admin of the user-management group without recording", async () => {
		const { deps, recorded } = await setup({
			loginState: { groups: ["admins"], lastSsoLoginAt: NOW },
		});
		await expect(
			checkUserManagement(deps, { userId: "admin-1", action: "change_role" }),
		).resolves.toEqual({ allow: true });
		expect(recorded).toHaveLength(0);
	});

	it("FR-010: the instance owner is allowed without reading the login state", async () => {
		const { deps } = await setup({ loginState: null });
		await expect(
			checkUserManagement(deps, { userId: "owner-id", action: "remove_user" }),
		).resolves.toEqual({ allow: true });
	});

	it("FR-009/NFR-PERF-001: with no group configured it reads nothing", async () => {
		const { deps } = await setup({ group: null });
		await expect(
			checkUserManagement(deps, { userId: "lead-1", action: "remove_user" }),
		).resolves.toEqual({ allow: true });
		expect(deps.services.instanceOwnerId).not.toHaveBeenCalled();
		expect(deps.loginState.find).not.toHaveBeenCalled();
	});

	it("FR-009: with SSO inactive it reads nothing", async () => {
		const { deps, repository } = await setup();
		await repository.save({ mode: "disabled" });
		deps.services.config.invalidate();
		await expect(
			checkUserManagement(deps, { userId: "lead-1", action: "remove_user" }),
		).resolves.toEqual({ allow: true });
		expect(deps.loginState.find).not.toHaveBeenCalled();
	});

	it.each(["config", "loginState", "owner"] as const)(
		"NFR-SEC-001: a failing %s lookup denies with check_failed",
		async (failing) => {
			const { deps } = await setup();
			const boom = new Error("db down");
			if (failing === "config") {
				vi.spyOn(deps.services.config, "getEffective").mockRejectedValue(boom);
			}
			if (failing === "loginState") {
				deps.loginState.find = vi.fn(async () => {
					throw boom;
				});
			}
			if (failing === "owner") {
				deps.services.instanceOwnerId = vi.fn(async () => {
					throw boom;
				});
			}
			await expect(
				checkUserManagement(deps, { userId: "lead-1", action: "invite" }),
			).resolves.toEqual({
				allow: false,
				reason: "check_failed",
				message: USER_MANAGEMENT_MESSAGES.check_failed,
			});
			expect(deps.logError).toHaveBeenCalled();
		},
	);

	it("NFR-SEC-001: a failing event write still denies", async () => {
		const { deps } = await setup();
		vi.spyOn(deps.services.events, "record").mockRejectedValue(
			new Error("insert failed"),
		);
		await expect(
			checkUserManagement(deps, { userId: "lead-1", action: "invite" }),
		).resolves.toMatchObject({ allow: false, reason: "not_in_group" });
		expect(deps.logError).toHaveBeenCalled();
	});

	it("FR-012: resolves the affected user from memberId or memberIdOrEmail", async () => {
		const { deps, recorded } = await setup();
		await checkUserManagement(deps, {
			userId: "lead-1",
			action: "remove_member",
			target: { memberIdOrEmail: "dev@example.com" },
		});
		expect(deps.resolveTarget).toHaveBeenCalledWith({
			memberIdOrEmail: "dev@example.com",
		});
		expect(recorded[0]).toMatchObject({ targetUserId: "resolved-user" });
	});

	it("FR-012: a failed target lookup still denies and records no target", async () => {
		const { deps, recorded } = await setup();
		deps.resolveTarget = vi.fn(async () => {
			throw new Error("lookup failed");
		});
		await expect(
			checkUserManagement(deps, {
				userId: "lead-1",
				action: "change_role",
				target: { memberId: "m-1" },
			}),
		).resolves.toMatchObject({ allow: false });
		expect(recorded[0]).not.toHaveProperty("targetUserId");
	});

	it("messages never reveal the configured group name", async () => {
		const { deps } = await setup({ group: "secret-admins-group" });
		const result = await checkUserManagement(deps, {
			userId: "lead-1",
			action: "invite",
		});
		expect(JSON.stringify(result)).not.toContain("secret-admins-group");
		for (const message of Object.values(USER_MANAGEMENT_MESSAGES)) {
			expect(message).not.toContain("secret-admins-group");
		}
	});
});

describe("getUserManagementStatus (spec 002, FR-007)", () => {
	it("FR-009: inactive feature means everyone can manage, no expiry", async () => {
		const { deps } = await setup({ group: null });
		await expect(getUserManagementStatus(deps, "lead-1")).resolves.toEqual({
			canManageUsers: true,
			reason: null,
			expiresAt: null,
		});
	});

	it("FR-007: a lead cannot manage users and nothing is recorded", async () => {
		const { deps, recorded } = await setup();
		await expect(getUserManagementStatus(deps, "lead-1")).resolves.toEqual({
			canManageUsers: false,
			reason: "not_in_group",
			expiresAt: null,
		});
		expect(recorded).toHaveLength(0);
	});

	it("FR-015: an expired grant is reported so the UI can explain it", async () => {
		const { deps } = await setup({
			loginState: {
				groups: ["admins"],
				lastSsoLoginAt: new Date(NOW.getTime() - USER_MANAGEMENT_GRANT_TTL_MS),
			},
		});
		await expect(
			getUserManagementStatus(deps, "admin-1"),
		).resolves.toMatchObject({
			canManageUsers: false,
			reason: "grant_expired",
		});
	});

	it("FR-015: an allowed admin gets the expiry of the grant", async () => {
		const { deps } = await setup({
			loginState: { groups: ["admins"], lastSsoLoginAt: NOW },
		});
		await expect(getUserManagementStatus(deps, "admin-1")).resolves.toEqual({
			canManageUsers: true,
			reason: null,
			expiresAt: new Date(
				NOW.getTime() + USER_MANAGEMENT_GRANT_TTL_MS,
			).toISOString(),
		});
	});

	it("FR-010: the owner has no expiry", async () => {
		const { deps } = await setup({ loginState: null });
		await expect(getUserManagementStatus(deps, "owner-id")).resolves.toEqual({
			canManageUsers: true,
			reason: null,
			expiresAt: null,
		});
	});

	it("NFR-SEC-001: a failure hides the actions", async () => {
		const { deps } = await setup();
		deps.loginState.find = vi.fn(async () => {
			throw new Error("db down");
		});
		await expect(getUserManagementStatus(deps, "lead-1")).resolves.toEqual({
			canManageUsers: false,
			reason: "check_failed",
			expiresAt: null,
		});
	});
});
