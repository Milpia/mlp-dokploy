import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeConfig, ISSUER, makeServices } from "./helpers";

const holder = vi.hoisted(() => ({
	services: null as unknown,
	loginState: null as { groups: string[]; lastSsoLoginAt: Date } | null,
}));

vi.mock("@dokploy/server/oidc-sso/services", () => ({
	getOidcSsoServices: () => holder.services,
}));

vi.mock("@dokploy/server/oidc-sso/identity/login-state", () => ({
	drizzleLoginStateStore: { find: async () => holder.loginState },
}));

const { oidcSsoRouter } = await import("@/server/api/routers/oidc-sso");

const caller = (role: "owner" | "admin" | "member" | null) =>
	oidcSsoRouter.createCaller({
		session: role ? ({ id: "s", activeOrganizationId: "org" } as never) : null,
		user: role
			? ({
					id: `${role}-id`,
					email: `${role}@example.com`,
					role,
					ownerId: "owner-id",
				} as never)
			: null,
		req: { headers: { "x-forwarded-for": "10.0.0.9, 10.0.0.1" } } as never,
		res: {} as never,
		db: {} as never,
	});

describe("oidcSso router", () => {
	let built: ReturnType<typeof makeServices>;
	beforeEach(() => {
		built = makeServices();
		holder.services = built.services;
	});

	it("FR-003: publicConfig is available without a session", async () => {
		await expect(caller(null).publicConfig()).resolves.toEqual({
			mode: "button",
			buttonLabel: "Sign in with SSO",
		});
	});

	it.each(["admin", "member"] as const)(
		"only the owner can read or change the configuration (%s is refused)",
		async (role) => {
			await expect(caller(role).get()).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(
				caller(role).update({ mode: "disabled" }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(caller(role).testConnection({})).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(caller(role).listEvents({})).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		},
	);

	it("security: owning another organization does not make you the instance owner", async () => {
		const orgOwner = oidcSsoRouter.createCaller({
			session: { id: "s", activeOrganizationId: "attacker-org" } as never,
			user: {
				id: "admin-who-created-an-org",
				email: "admin@example.com",
				role: "owner",
				ownerId: "admin-who-created-an-org",
			} as never,
			req: { headers: {} } as never,
			res: {} as never,
			db: {} as never,
		});
		await expect(orgOwner.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			orgOwner.update({
				issuerUrl: "https://attacker.example.com/realms/x",
				mode: "button",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(built.repository.save).not.toHaveBeenCalled();
	});

	it("denies everyone when the instance has no owner yet", async () => {
		built.services.instanceOwnerId = async () => null;
		await expect(caller("owner").get()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("requires a session for owner procedures", async () => {
		await expect(caller(null).get()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("FR-015: get never returns the secret", async () => {
		const view = await caller("owner").get();
		expect(view).not.toHaveProperty("clientSecret");
		expect(view.hasClientSecret).toBe(true);
	});

	it("FR-011: an unverified sso-only switch is a precondition failure", async () => {
		await expect(
			caller("owner").update({ mode: "sso-only" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("an insecure issuer is a bad request", async () => {
		await expect(
			caller("owner").update({ issuerUrl: "http://kc.local/realms/x" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("records the actor and client IP on changes", async () => {
		built = makeServices({
			config: { ...activeConfig, verifiedIssuer: ISSUER },
		});
		holder.services = built.services;
		await caller("owner").update({ mode: "sso-only" });
		expect(built.recorded.at(-1)).toMatchObject({
			type: "mode_change",
			userId: "owner-id",
			email: "owner@example.com",
			ip: "10.0.0.9",
		});
	});

	it("validates the button label length", async () => {
		await expect(
			caller("owner").update({ buttonLabel: "x".repeat(65) }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("listEvents returns recent events for the owner", async () => {
		await expect(caller("owner").listEvents({ limit: 10 })).resolves.toEqual(
			[],
		);
	});

	it("spec 003 FR-001: get shows the emergency origin, which update cannot set", async () => {
		await expect(caller("owner").get()).resolves.toMatchObject({
			emergencyOrigin: null,
		});

		built = makeServices({ emergencyOrigin: "http://localhost:3900" });
		holder.services = built.services;
		await expect(caller("owner").get()).resolves.toMatchObject({
			emergencyOrigin: "http://localhost:3900",
		});

		await caller("owner").update({
			emergencyOrigin: "http://evil.example.com",
		} as never);
		await expect(caller("owner").get()).resolves.toMatchObject({
			emergencyOrigin: "http://localhost:3900",
		});
	});

	it("spec 003 FR-007: listEvents keeps the emergency origin flag", async () => {
		vi.spyOn(built.services.events, "listRecent").mockResolvedValue([
			{
				id: "e1",
				createdAt: new Date("2026-09-25T10:00:00Z"),
				type: "emergency_login",
				outcome: "success",
				correlationId: "ABC",
				emergencyOrigin: true,
			},
		]);
		await expect(caller("owner").listEvents({})).resolves.toMatchObject([
			{ correlationId: "ABC", emergencyOrigin: true },
		]);
	});

	it("FR-014: testConnection delegates to the OIDC client", async () => {
		await expect(caller("owner").testConnection({})).resolves.toEqual({
			ok: true,
			issuer: ISSUER,
		});
	});

	it("spec 002 FR-007: userManagementStatus is open to any signed-in user", async () => {
		built = makeServices({
			config: { ...activeConfig, userManagementGroup: "admins" },
		});
		built.services.instanceOwnerId = async () => "owner-id";
		holder.services = built.services;
		holder.loginState = { groups: ["leads"], lastSsoLoginAt: new Date() };
		await expect(caller("admin").userManagementStatus()).resolves.toEqual({
			canManageUsers: false,
			reason: "not_in_group",
			expiresAt: null,
		});
		await expect(caller("owner").userManagementStatus()).resolves.toMatchObject(
			{ canManageUsers: true },
		);
		await expect(caller(null).userManagementStatus()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});
