import {
	completeLogin,
	resolveSignOutTarget,
	startLogin,
} from "@dokploy/server/keycloak-sso/plugin/login-flow";
import { describe, expect, it, vi } from "vitest";
import {
	activeConfig,
	fakeOidc,
	fakeProvisioningStore,
	ISSUER,
	makeDeps,
} from "./helpers";

const tx = {
	state: "st",
	nonce: "no",
	codeVerifier: "ve",
	returnTo: "/dashboard/projects",
};
const callback = (query = "code=abc&state=st") =>
	new URL(`https://dokploy.example.com/api/auth/keycloak/callback?${query}`);
const redirectUri = "https://dokploy.example.com/api/auth/keycloak/callback";

describe("startLogin", () => {
	it("FR-005: returns the authorization URL and a sanitised returnTo", async () => {
		const { deps } = makeDeps();
		const result = await startLogin(deps, {
			returnTo: "https://evil.example.com",
			redirectUri,
		});
		expect(result).toMatchObject({
			ok: true,
			tx: { returnTo: "/dashboard/home", state: "st" },
		});
	});

	it("FR-016: maps an unreachable Keycloak to keycloak_unavailable and records it", async () => {
		const oidc = fakeOidc({
			createAuthorizationRequest: vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		});
		const { deps, recorded } = makeDeps({ oidc });
		const result = await startLogin(deps, { returnTo: "/", redirectUri });
		expect(result).toMatchObject({ ok: false, code: "keycloak_unavailable" });
		expect(recorded[0]).toMatchObject({
			type: "sso_login",
			outcome: "error",
			reason: "keycloak_unavailable",
		});
	});
});

describe("completeLogin", () => {
	it("FR-005: provisions the user and returns the original page", async () => {
		const { deps, recorded } = makeDeps();
		const result = await completeLogin(deps, {
			tx,
			callbackUrl: callback(),
			redirectUri,
			ip: "10.0.0.1",
		});
		expect(result).toMatchObject({
			ok: true,
			userId: "new-user-id",
			returnTo: "/dashboard/projects",
		});
		expect(recorded.at(-1)).toMatchObject({
			type: "sso_login",
			outcome: "success",
			reason: "create",
			email: "dev@example.com",
			ip: "10.0.0.1",
		});
	});

	it("US1-5: a cancelled login is reported as cancelled", async () => {
		const { deps, oidc } = makeDeps();
		const result = await completeLogin(deps, {
			tx,
			callbackUrl: callback("error=access_denied&state=st"),
			redirectUri,
		});
		expect(result).toMatchObject({ ok: false, code: "keycloak_cancelled" });
		expect(oidc.exchangeCode).not.toHaveBeenCalled();
	});

	it("rejects other provider errors as invalid responses", async () => {
		const { deps } = makeDeps();
		await expect(
			completeLogin(deps, {
				tx,
				callbackUrl: callback("error=server_error"),
				redirectUri,
			}),
		).resolves.toMatchObject({ code: "keycloak_invalid_response" });
	});

	it("NFR-SEC-001: fails closed without the login transaction cookie", async () => {
		const { deps, oidc } = makeDeps();
		const result = await completeLogin(deps, {
			tx: null,
			callbackUrl: callback(),
			redirectUri,
		});
		expect(result).toMatchObject({
			ok: false,
			code: "keycloak_invalid_response",
		});
		expect(oidc.exchangeCode).not.toHaveBeenCalled();
	});

	it("NFR-SEC-002: a failed token validation is an invalid response", async () => {
		const oidc = fakeOidc({
			exchangeCode: vi.fn(async () => {
				throw Object.assign(new Error("nonce mismatch"), {
					code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
				});
			}),
		});
		const { deps, recorded } = makeDeps({ oidc });
		const result = await completeLogin(deps, {
			tx,
			callbackUrl: callback(),
			redirectUri,
		});
		expect(result).toMatchObject({ code: "keycloak_invalid_response" });
		expect(recorded.at(-1)).toMatchObject({ outcome: "error" });
	});

	it("rejects an ID token without subject", async () => {
		const oidc = fakeOidc({
			exchangeCode: vi.fn(async () => ({ claims: {}, idToken: "t" })),
		});
		const { deps } = makeDeps({ oidc });
		await expect(
			completeLogin(deps, { tx, callbackUrl: callback(), redirectUri }),
		).resolves.toMatchObject({ code: "keycloak_invalid_response" });
	});

	it("FR-006: an unverified email is reported as such", async () => {
		const oidc = fakeOidc({
			exchangeCode: vi.fn(async () => ({
				claims: { sub: "s", email: "a@b.c", email_verified: false },
				idToken: "t",
			})),
		});
		const { deps, recorded } = makeDeps({ oidc });
		await expect(
			completeLogin(deps, { tx, callbackUrl: callback(), redirectUri }),
		).resolves.toMatchObject({ code: "keycloak_email_unverified" });
		expect(recorded.at(-1)).toMatchObject({
			outcome: "denied",
			reason: "email_unverified",
		});
	});

	it("FR-007: users outside the access group are denied and logged", async () => {
		const oidc = fakeOidc({
			exchangeCode: vi.fn(async () => ({
				claims: {
					sub: "s",
					email: "out@example.com",
					email_verified: true,
					groups: [],
				},
				idToken: "t",
			})),
		});
		const { deps, recorded } = makeDeps({ oidc });
		await expect(
			completeLogin(deps, { tx, callbackUrl: callback(), redirectUri }),
		).resolves.toMatchObject({ code: "keycloak_access_denied" });
		expect(recorded.at(-1)).toMatchObject({
			outcome: "denied",
			reason: "not_in_access_group",
			email: "out@example.com",
		});
	});

	it("maps a provisioning crash to keycloak_unavailable", async () => {
		const store = fakeProvisioningStore({
			transaction: vi.fn(async () => {
				throw new Error("db down");
			}),
		});
		const { deps } = makeDeps({ store });
		await expect(
			completeLogin(deps, { tx, callbackUrl: callback(), redirectUri }),
		).resolves.toMatchObject({ code: "keycloak_unavailable" });
	});

	it("FR-011: the owner's successful login verifies the issuer", async () => {
		const store = fakeProvisioningStore({
			findUserByEmail: vi.fn(async () => ({
				id: "owner-id",
				banned: false,
				linkedSub: null,
			})),
		});
		const { deps, repository } = makeDeps({ store });
		await completeLogin(deps, { tx, callbackUrl: callback(), redirectUri });
		expect(repository.save).toHaveBeenCalledWith(
			expect.objectContaining({ verifiedIssuer: ISSUER }),
		);
	});

	it("FR-011: an already verified issuer is not written again", async () => {
		const store = fakeProvisioningStore({
			findUserByEmail: vi.fn(async () => ({
				id: "owner-id",
				banned: false,
				linkedSub: null,
			})),
		});
		const { deps, repository } = makeDeps({
			store,
			config: { ...activeConfig, verifiedIssuer: ISSUER },
		});
		await completeLogin(deps, { tx, callbackUrl: callback(), redirectUri });
		expect(repository.save).not.toHaveBeenCalled();
	});

	it("FR-011: a non-owner login never verifies the issuer", async () => {
		const { deps, repository } = makeDeps();
		await completeLogin(deps, { tx, callbackUrl: callback(), redirectUri });
		expect(repository.save).not.toHaveBeenCalled();
	});
});

describe("resolveSignOutTarget (FR-010)", () => {
	it("button mode only signs out of Dokploy", async () => {
		const { deps, oidc } = makeDeps();
		await expect(
			resolveSignOutTarget(deps, { origin: "https://d.example.com" }),
		).resolves.toBe("/");
		expect(oidc.buildEndSessionUrl).not.toHaveBeenCalled();
	});

	it("sso-only mode ends the Keycloak session too", async () => {
		const { deps, oidc } = makeDeps({
			config: { ...activeConfig, mode: "sso-only", verifiedIssuer: ISSUER },
		});
		await expect(
			resolveSignOutTarget(deps, {
				origin: "https://d.example.com",
				idToken: "hint",
			}),
		).resolves.toContain("/protocol/openid-connect/logout");
		expect(oidc.buildEndSessionUrl).toHaveBeenCalledWith(expect.anything(), {
			idTokenHint: "hint",
			postLogoutRedirectUri: "https://d.example.com/",
		});
	});

	it("falls back to / when Keycloak has no end-session URL", async () => {
		const oidc = fakeOidc({ buildEndSessionUrl: vi.fn(async () => null) });
		const { deps } = makeDeps({
			oidc,
			config: { ...activeConfig, mode: "sso-only", verifiedIssuer: ISSUER },
		});
		await expect(
			resolveSignOutTarget(deps, { origin: "https://d.example.com" }),
		).resolves.toBe("/");
	});

	it("an inactive configuration never calls Keycloak", async () => {
		const { deps, oidc } = makeDeps({
			config: { ...activeConfig, mode: "disabled" },
		});
		await expect(
			resolveSignOutTarget(deps, { origin: "https://d.example.com" }),
		).resolves.toBe("/");
		expect(oidc.buildEndSessionUrl).not.toHaveBeenCalled();
	});
});
