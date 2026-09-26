import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import type { UserManagementGuardDeps } from "@dokploy/server/oidc-sso/user-management/guard";
import { AUTH_USER_MANAGEMENT_PATHS } from "@dokploy/server/oidc-sso/user-management/paths";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeConfig, makeDeps } from "./helpers";

const BASE = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-09-26T12:00:00Z");

const setup = (groups: string[] | null) => {
	const built = makeDeps({
		config: { ...activeConfig, userManagementGroup: "admins" },
	});
	const guardDeps: UserManagementGuardDeps = {
		services: built.services,
		loginState: {
			find: vi.fn(async () =>
				groups ? { groups, lastSsoLoginAt: NOW } : null,
			),
		},
		resolveTarget: vi.fn(async () => "target-user"),
		now: () => NOW,
		logError: vi.fn(),
	};
	const memory = {
		user: [] as Record<string, unknown>[],
		session: [] as Record<string, unknown>[],
		account: [] as Record<string, unknown>[],
		verification: [] as Record<string, unknown>[],
		organization: [] as Record<string, unknown>[],
		member: [] as Record<string, unknown>[],
		invitation: [] as Record<string, unknown>[],
	};
	const auth = betterAuth({
		baseURL: BASE,
		secret: "test-secret-that-is-long-enough-for-better-auth",
		database: memoryAdapter(memory),
		rateLimit: { enabled: false },
		emailAndPassword: { enabled: true },
		plugins: [
			organization({ dynamicAccessControl: { enabled: true } }),
			oidcSso({
				resolveDeps: () => built.deps,
				resolveUserManagementDeps: () => guardDeps,
			}),
		],
	});
	return { ...built, auth, guardDeps };
};

type Ctx = ReturnType<typeof setup>;

const post = (
	ctx: Ctx,
	path: string,
	body: Record<string, unknown>,
	cookie?: string,
) =>
	ctx.auth.handler(
		new Request(`${BASE}/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: BASE,
				...(cookie ? { cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const cookiesFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0] ?? "")
		.join("; ");

const signedIn = async (ctx: Ctx) => {
	const signUp = await post(ctx, "/sign-up/email", {
		email: "lead@example.com",
		password: PASSWORD,
		name: "Lead",
	});
	const cookie = cookiesFrom(signUp);
	const org = await post(
		ctx,
		"/organization/create",
		{ name: "Org", slug: "org" },
		cookie,
	);
	expect(org.status).toBe(200);
	return cookie;
};

describe("better-auth organization routes guard (spec 002)", () => {
	let ctx: Ctx;

	beforeEach(() => {
		ctx = setup(["leads"]);
	});

	it.each([...AUTH_USER_MANAGEMENT_PATHS.keys()])(
		"FR-004/FR-006: %s is 403 for a lead",
		async (path) => {
			const cookie = await signedIn(ctx);
			const response = await post(
				ctx,
				path,
				{
					email: "new@example.com",
					role: "member",
					memberIdOrEmail: "dev@example.com",
					memberId: "m-1",
					invitationId: "i-1",
					role_name: "custom",
				},
				cookie,
			);
			expect(response.status).toBe(403);
			expect(((await response.json()) as { message: string }).message).toBe(
				"You are not allowed to manage users.",
			);
		},
	);

	it("FR-012: records the denial with the resolved target", async () => {
		const cookie = await signedIn(ctx);
		await post(
			ctx,
			"/organization/remove-member",
			{ memberIdOrEmail: "dev@example.com" },
			cookie,
		);
		expect(ctx.guardDeps.resolveTarget).toHaveBeenCalledWith({
			memberIdOrEmail: "dev@example.com",
		});
		expect(ctx.recorded.at(-1)).toMatchObject({
			type: "user_management",
			action: "remove_member",
			targetUserId: "target-user",
		});
	});

	it("leaves requests without a session to better-auth", async () => {
		const response = await post(ctx, "/organization/invite-member", {
			email: "new@example.com",
			role: "member",
		});
		expect(response.status).toBe(401);
		expect(ctx.guardDeps.loginState.find).not.toHaveBeenCalled();
	});

	it("FR-005: other organization routes are not matched", async () => {
		const cookie = await signedIn(ctx);
		const response = await ctx.auth.handler(
			new Request(`${BASE}/api/auth/organization/list`, {
				headers: { cookie },
			}),
		);
		expect(response.status).toBe(200);
		expect(ctx.guardDeps.loginState.find).not.toHaveBeenCalled();
	});

	it("FR-003: a member of the user-management group gets through to better-auth", async () => {
		ctx = setup(["admins"]);
		const cookie = await signedIn(ctx);
		const response = await post(
			ctx,
			"/organization/invite-member",
			{ email: "new@example.com", role: "member" },
			cookie,
		);
		expect(response.status).toBe(200);
	});
});
