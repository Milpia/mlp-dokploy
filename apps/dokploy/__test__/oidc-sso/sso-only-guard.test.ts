import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import {
	evaluateLocalAuth,
	isGuardedPath,
	SSO_REQUIRED_MESSAGE,
} from "@dokploy/server/oidc-sso/plugin/sso-only-guard";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { ISSUER, makeDeps } from "./helpers";

const BASE = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

describe("evaluateLocalAuth (pure)", () => {
	const owner = "owner@example.com";

	it("SC-006: never interferes outside sso-only", () => {
		expect(
			evaluateLocalAuth({
				path: "/sign-up/email",
				email: "x@y.z",
				ownerEmail: owner,
				ssoOnly: false,
			}),
		).toEqual({ action: "allow" });
	});

	it("leaves unrelated routes alone", () => {
		for (const path of [
			"/get-session",
			"/sign-out",
			"/two-factor/verify-totp",
			"/oidc/callback",
		]) {
			expect(isGuardedPath(path)).toBe(false);
		}
	});

	it("FR-009: blocks every other local way in, including future sign-in methods", () => {
		for (const path of [
			"/sign-up/email",
			"/sign-in/social",
			"/sign-in/passkey",
			"/sign-in/sso",
			"/sign-in/some-future-method",
			"/passkey/verify-authentication",
			"/passkey/generate-authenticate-options",
			"/request-password-reset",
			"/forget-password",
			"/reset-password",
		]) {
			expect(
				evaluateLocalAuth({
					path,
					email: owner,
					ownerEmail: owner,
					ssoOnly: true,
				}),
			).toMatchObject({ action: "deny", emergencyAttempt: false });
		}
	});

	it("FR-012: only the owner's email may use the password form (case-insensitive)", () => {
		expect(
			evaluateLocalAuth({
				path: "/sign-in/email",
				email: "  Owner@Example.com ",
				ownerEmail: owner,
				ssoOnly: true,
			}),
		).toEqual({ action: "emergency" });
		expect(
			evaluateLocalAuth({
				path: "/sign-in/email",
				email: "dev@example.com",
				ownerEmail: owner,
				ssoOnly: true,
			}),
		).toMatchObject({ action: "deny", emergencyAttempt: true });
	});

	it("fails closed when the owner is unknown or the email is malformed", () => {
		for (const [email, ownerEmail] of [
			[owner, null],
			[undefined, owner],
			[{ $ne: "" }, owner],
		] as const) {
			expect(
				evaluateLocalAuth({
					path: "/sign-in/email",
					email,
					ownerEmail,
					ssoOnly: true,
				}),
			).toMatchObject({ action: "deny" });
		}
	});
});

describe("SSO-only guard with a real better-auth instance", () => {
	let ctx: ReturnType<typeof setup>;

	const setup = () => {
		const built = makeDeps();
		const memory = {
			user: [] as Record<string, unknown>[],
			session: [] as Record<string, unknown>[],
			account: [] as Record<string, unknown>[],
			verification: [] as Record<string, unknown>[],
		};
		const auth = betterAuth({
			baseURL: BASE,
			secret: "test-secret-that-is-long-enough-for-better-auth",
			database: memoryAdapter(memory),
			rateLimit: { enabled: false },
			emailAndPassword: {
				enabled: true,
				sendResetPassword: async () => {},
			},
			plugins: [oidcSso({ resolveDeps: () => built.deps })],
		});
		return { ...built, auth, memory };
	};

	const post = (path: string, body: Record<string, unknown>) =>
		ctx.auth.handler(
			new Request(`${BASE}/api/auth${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: BASE,
					"x-forwarded-for": "10.1.1.1",
				},
				body: JSON.stringify(body),
			}),
		);

	const enableSsoOnly = async () => {
		await ctx.repository.save({ mode: "sso-only", verifiedIssuer: ISSUER });
		ctx.services.config.invalidate();
	};

	beforeEach(async () => {
		ctx = setup();
		for (const email of ["owner@example.com", "dev@example.com"]) {
			const response = await post("/sign-up/email", {
				email,
				password: PASSWORD,
				name: email,
			});
			expect(response.status).toBe(200);
		}
	});

	it("SC-006: in button mode local sign-in keeps working for everyone", async () => {
		const response = await post("/sign-in/email", {
			email: "dev@example.com",
			password: PASSWORD,
		});
		expect(response.status).toBe(200);
	});

	it("SC-005: in sso-only mode a non-owner cannot sign in with a password", async () => {
		await enableSsoOnly();
		const response = await post("/sign-in/email", {
			email: "dev@example.com",
			password: PASSWORD,
		});
		expect(response.status).toBe(403);
		expect(ctx.recorded.at(-1)).toMatchObject({
			type: "emergency_login",
			outcome: "denied",
			reason: "not_owner",
			email: "dev@example.com",
		});
	});

	it("FR-012/FR-013: the owner can use the emergency sign-in and it is recorded", async () => {
		await enableSsoOnly();
		const response = await post("/sign-in/email", {
			email: "owner@example.com",
			password: PASSWORD,
		});
		expect(response.status).toBe(200);
		expect(ctx.recorded.at(-1)).toMatchObject({
			type: "emergency_login",
			outcome: "success",
			email: "owner@example.com",
		});
	});

	it("FR-013: a failed owner emergency sign-in is recorded as denied", async () => {
		await enableSsoOnly();
		const response = await post("/sign-in/email", {
			email: "owner@example.com",
			password: "wrong password here",
		});
		expect(response.status).toBe(401);
		expect(ctx.recorded.at(-1)).toMatchObject({
			type: "emergency_login",
			outcome: "denied",
			reason: "invalid_credentials",
		});
	});

	it("FR-009: sign-up (and so invitation acceptance) is refused with guidance", async () => {
		await enableSsoOnly();
		const response = await post("/sign-up/email", {
			email: "new@example.com",
			password: PASSWORD,
			name: "New",
		});
		expect(response.status).toBe(403);
		expect(((await response.json()) as { message: string }).message).toBe(
			SSO_REQUIRED_MESSAGE,
		);
	});

	it("FR-009: password reset requests are refused", async () => {
		await enableSsoOnly();
		const response = await post("/request-password-reset", {
			email: "dev@example.com",
		});
		expect(response.status).toBe(403);
	});
});
