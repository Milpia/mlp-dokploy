import { createHmac } from "node:crypto";
import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { twoFactor } from "better-auth/plugins";
import { beforeEach, describe, expect, it } from "vitest";
import { ISSUER, makeDeps } from "./helpers";

// The public address differs from the tunnel origin on purpose: that mismatch
// is what makes better-auth reject the emergency login today (research R1).
const BASE = "https://deploy.example.test";
const TUNNEL = "http://localhost:3900";
const PASSWORD = "correct horse battery staple";
const OWNER = "owner@example.com";
// Browsers send localhost cookies from other local apps on any port, and any
// cookie turns on the router-level origin check.
const FOREIGN_COOKIE = "dev_app_session=1";

const base32Decode = (input: string): Buffer => {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of input.replace(/=+$/, "").toUpperCase()) {
		bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
	}
	const bytes: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
};

const totp = (secret: string, now = Date.now()): string => {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
	const hmac = createHmac("sha1", base32Decode(secret))
		.update(counter)
		.digest();
	const offset = (hmac.at(-1) ?? 0) & 0x0f;
	const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
	return code.toString().padStart(6, "0");
};

const cookiesFrom = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.filter((pair) => !pair.endsWith("="))
		.join("; ");

const setup = (emergencyOrigin: string | null) => {
	const built = makeDeps({ emergencyOrigin });
	const memory = {
		user: [] as Record<string, unknown>[],
		session: [] as Record<string, unknown>[],
		account: [] as Record<string, unknown>[],
		verification: [] as Record<string, unknown>[],
		twoFactor: [] as Record<string, unknown>[],
	};
	const auth = betterAuth({
		baseURL: BASE,
		secret: "test-secret-that-is-long-enough-for-better-auth",
		database: memoryAdapter(memory),
		rateLimit: { enabled: false },
		// better-auth skips origin checks under test unless told otherwise.
		advanced: { disableOriginCheck: false },
		trustedOrigins: async () => [],
		emailAndPassword: { enabled: true, sendResetPassword: async () => {} },
		plugins: [
			twoFactor({ skipVerificationOnEnable: true }),
			oidcSso({ resolveDeps: () => built.deps }),
		],
	});
	return { ...built, auth, memory };
};

type Ctx = ReturnType<typeof setup>;

const post = (
	ctx: Ctx,
	path: string,
	body: Record<string, unknown>,
	{ origin = TUNNEL, cookie = FOREIGN_COOKIE } = {},
) =>
	ctx.auth.handler(
		new Request(`${BASE}/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin,
				cookie,
				"x-forwarded-for": "127.0.0.1",
			},
			body: JSON.stringify(body),
		}),
	);

const signUp = async (ctx: Ctx, email: string) => {
	const response = await post(
		ctx,
		"/sign-up/email",
		{ email, password: PASSWORD, name: email },
		{ origin: BASE },
	);
	expect(response.status).toBe(200);
	return cookiesFrom(response);
};

const enableSsoOnly = async (ctx: Ctx) => {
	await ctx.repository.save({ mode: "sso-only", verifiedIssuer: ISSUER });
	ctx.services.config.invalidate();
};

const enableTwoFactor = async (ctx: Ctx, sessionCookie: string) => {
	const response = await post(
		ctx,
		"/two-factor/enable",
		{ password: PASSWORD },
		{ origin: BASE, cookie: sessionCookie },
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		totpURI: string;
		backupCodes: string[];
	};
	const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
	return { secret, backupCodes: body.backupCodes };
};

describe("emergency origin through a real better-auth instance (spec 003)", () => {
	describe("US1: the owner recovers access through the tunnel", () => {
		let ctx: Ctx;

		beforeEach(async () => {
			ctx = setup(TUNNEL);
			await signUp(ctx, OWNER);
			await signUp(ctx, "dev@example.com");
			await enableSsoOnly(ctx);
		});

		it("FR-004/SC-001: the owner signs in from the tunnel origin with a foreign cookie", async () => {
			const response = await post(ctx, "/sign-in/email", {
				email: OWNER,
				password: PASSWORD,
			});
			expect(response.status).toBe(200);
			expect(cookiesFrom(response)).toContain("session_token");
		});

		it("FR-007: the successful emergency login is flagged as coming from the emergency origin", async () => {
			await post(ctx, "/sign-in/email", { email: OWNER, password: PASSWORD });
			expect(ctx.recorded.at(-1)).toMatchObject({
				type: "emergency_login",
				outcome: "success",
				email: OWNER,
				emergencyOrigin: true,
			});
		});

		it("FR-009: the owner signs out from the tunnel origin", async () => {
			const signIn = await post(ctx, "/sign-in/email", {
				email: OWNER,
				password: PASSWORD,
			});
			const session = cookiesFrom(signIn);
			const { token } = (await signIn.json()) as { token: string };
			expect(ctx.memory.session.some((s) => s.token === token)).toBe(true);

			const signOut = await post(
				ctx,
				"/sign-out",
				{},
				{ cookie: `${FOREIGN_COOKIE}; ${session}` },
			);
			expect(signOut.status).toBe(200);
			expect(ctx.memory.session.some((s) => s.token === token)).toBe(false);
		});
	});

	describe("US1: the owner has a second factor", () => {
		let ctx: Ctx;
		let factor: { secret: string; backupCodes: string[] };

		beforeEach(async () => {
			ctx = setup(TUNNEL);
			const ownerSession = await signUp(ctx, OWNER);
			factor = await enableTwoFactor(ctx, ownerSession);
			await enableSsoOnly(ctx);
		});

		const startSignIn = async () => {
			const response = await post(ctx, "/sign-in/email", {
				email: OWNER,
				password: PASSWORD,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
			return `${FOREIGN_COOKIE}; ${cookiesFrom(response)}`;
		};

		it("FR-005: completes the TOTP step from the tunnel origin", async () => {
			const cookie = await startSignIn();
			const response = await post(
				ctx,
				"/two-factor/verify-totp",
				{ code: totp(factor.secret) },
				{ cookie },
			);
			expect(response.status).toBe(200);
			expect(cookiesFrom(response)).toContain("session_token");
		});

		it("FR-005: completes the backup code step from the tunnel origin", async () => {
			const cookie = await startSignIn();
			const response = await post(
				ctx,
				"/two-factor/verify-backup-code",
				{ code: factor.backupCodes[0] },
				{ cookie },
			);
			expect(response.status).toBe(200);
			expect(cookiesFrom(response)).toContain("session_token");
		});
	});

	describe("US2: the emergency origin opens nothing else", () => {
		let ctx: Ctx;

		beforeEach(async () => {
			ctx = setup(TUNNEL);
			await signUp(ctx, OWNER);
			await signUp(ctx, "dev@example.com");
			await enableSsoOnly(ctx);
		});

		const expectInvalidOrigin = async (response: Response) => {
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
		};

		it("FR-006/FR-007: a non-owner sign-in is rejected and recorded as coming from the tunnel", async () => {
			const response = await post(ctx, "/sign-in/email", {
				email: "Dev@Example.com",
				password: PASSWORD,
			});
			await expectInvalidOrigin(response);
			expect(ctx.recorded.at(-1)).toMatchObject({
				type: "emergency_login",
				outcome: "denied",
				reason: "not_owner",
				email: "dev@example.com",
				emergencyOrigin: true,
			});
		});

		it.each([
			[
				"/sign-up/email",
				{ email: "new@example.com", password: PASSWORD, name: "N" },
			],
			["/request-password-reset", { email: OWNER }],
		])("SC-002: %s from the tunnel origin is rejected", async (path, body) => {
			await expectInvalidOrigin(await post(ctx, path, body));
		});

		it.each([
			[
				"/change-password",
				{ currentPassword: PASSWORD, newPassword: "another long password" },
			],
			["/two-factor/disable", { password: PASSWORD }],
		])(
			"SC-002: %s with the owner's tunnel session is rejected",
			async (path, body) => {
				const signIn = await post(ctx, "/sign-in/email", {
					email: OWNER,
					password: PASSWORD,
				});
				const cookie = `${FOREIGN_COOKIE}; ${cookiesFrom(signIn)}`;
				await expectInvalidOrigin(await post(ctx, path, body, { cookie }));
			},
		);

		it.each(["button", "disabled"] as const)(
			"SC-003: in %s mode the owner's sign-in from the tunnel is rejected",
			async (mode) => {
				await ctx.repository.save({ mode });
				ctx.services.config.invalidate();
				await expectInvalidOrigin(
					await post(ctx, "/sign-in/email", {
						email: OWNER,
						password: PASSWORD,
					}),
				);
			},
		);

		it("NFR-SEC-001: a client-supplied marker neither opens the tunnel nor flags events", async () => {
			const forged = { "x-oidc-sso-emergency-origin": "1" };
			const fromTunnel = await ctx.auth.handler(
				new Request(`${BASE}/api/auth/request-password-reset`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: TUNNEL,
						cookie: FOREIGN_COOKIE,
						...forged,
					},
					body: JSON.stringify({ email: OWNER }),
				}),
			);
			await expectInvalidOrigin(fromTunnel);

			const fromPublic = await ctx.auth.handler(
				new Request(`${BASE}/api/auth/sign-in/email`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: BASE,
						...forged,
					},
					body: JSON.stringify({ email: OWNER, password: PASSWORD }),
				}),
			);
			expect(fromPublic.status).toBe(200);
			expect(ctx.recorded.at(-1)?.emergencyOrigin).toBeUndefined();
		});
	});

	describe("US3: without the setting nothing changes", () => {
		it("FR-003: the owner's sign-in from the tunnel origin is rejected as today", async () => {
			const ctx = setup(null);
			await signUp(ctx, OWNER);
			await enableSsoOnly(ctx);
			const response = await post(ctx, "/sign-in/email", {
				email: OWNER,
				password: PASSWORD,
			});
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
		});
	});
});
