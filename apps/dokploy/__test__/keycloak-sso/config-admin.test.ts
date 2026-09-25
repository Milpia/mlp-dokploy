import {
	ConfigUpdateError,
	getConfigView,
	getPublicConfig,
	testKeycloakConnection,
	updateKeycloakConfig,
} from "@dokploy/server/keycloak-sso/admin/config-admin";
import { DEFAULT_STORED_CONFIG } from "@dokploy/server/keycloak-sso/config/repository";
import { describe, expect, it } from "vitest";
import { activeConfig, ISSUER, makeServices } from "./helpers";

const actor = { userId: "owner-id", email: "owner@example.com" };

const expectError = async (promise: Promise<unknown>, code: string) => {
	await expect(promise).rejects.toBeInstanceOf(ConfigUpdateError);
	await expect(promise).rejects.toMatchObject({ code });
};

describe("getConfigView", () => {
	it("FR-015: never exposes the client secret", async () => {
		const { services } = makeServices();
		const view = await getConfigView(services);
		expect(view.hasClientSecret).toBe(true);
		expect(JSON.stringify(view)).not.toContain('secret"');
		expect(view).not.toHaveProperty("clientSecret");
	});

	it("FR-020: reports env-sourced fields and env errors", async () => {
		const { services } = makeServices({
			env: { values: { clientId: "env-client" }, errors: ["bad mode"] },
		});
		const view = await getConfigView(services);
		expect(view.sources.clientId).toBe("env");
		expect(view.clientId).toBe("env-client");
		expect(view.envErrors).toEqual(["bad mode"]);
	});

	it("FR-011: shows the requested sso-only mode and the degraded effective mode", async () => {
		const { services } = makeServices({
			config: { ...activeConfig, mode: "sso-only" },
		});
		const view = await getConfigView(services);
		expect(view.mode).toBe("sso-only");
		expect(view.effectiveMode).toBe("button");
		expect(view.verified).toBe(false);
	});
});

describe("updateKeycloakConfig", () => {
	it("FR-001: saves a complete configuration and enables button mode", async () => {
		const { services, repository, recorded } = makeServices({
			config: DEFAULT_STORED_CONFIG,
		});
		const view = await updateKeycloakConfig(
			services,
			{
				issuerUrl: `${ISSUER}/`,
				clientId: "dokploy",
				clientSecret: "  s3cret ",
				accessGroup: "dokploy-users",
				mode: "button",
			},
			actor,
		);
		expect(repository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				issuerUrl: ISSUER,
				clientSecret: "s3cret",
				mode: "button",
			}),
		);
		expect(view).toMatchObject({ active: true, effectiveMode: "button" });
		expect(recorded.map((e) => e.type)).toEqual([
			"config_change",
			"mode_change",
		]);
		expect(recorded[0]?.reason).toBe(
			"accessGroup,clientId,clientSecret,issuerUrl",
		);
		expect(JSON.stringify(recorded)).not.toContain("s3cret");
	});

	it("FR-015: an empty secret keeps the stored one", async () => {
		const { services, repository } = makeServices();
		await updateKeycloakConfig(
			services,
			{ clientSecret: "", buttonLabel: "Entrar" },
			actor,
		);
		expect(repository.save).toHaveBeenCalledWith({ buttonLabel: "Entrar" });
	});

	it("FR-018: the change is visible immediately", async () => {
		const { services } = makeServices();
		await getConfigView(services);
		await updateKeycloakConfig(services, { buttonLabel: "Entrar" }, actor);
		expect((await getPublicConfig(services)).buttonLabel).toBe("Entrar");
	});

	it("FR-001: refuses to enable a mode with an incomplete configuration", async () => {
		const { services } = makeServices({ config: DEFAULT_STORED_CONFIG });
		await expectError(
			updateKeycloakConfig(services, { mode: "button" }, actor),
			"incomplete",
		);
	});

	it("refuses to clear the client ID while active", async () => {
		const { services } = makeServices();
		await expectError(
			updateKeycloakConfig(services, { clientId: "" }, actor),
			"incomplete",
		);
	});

	it("FR-011: refuses sso-only until the owner verified the issuer", async () => {
		const { services } = makeServices();
		await expectError(
			updateKeycloakConfig(services, { mode: "sso-only" }, actor),
			"unverified",
		);
	});

	it("FR-011: allows sso-only once verified", async () => {
		const { services } = makeServices({
			config: { ...activeConfig, verifiedIssuer: ISSUER },
		});
		const view = await updateKeycloakConfig(
			services,
			{ mode: "sso-only" },
			actor,
		);
		expect(view.effectiveMode).toBe("sso-only");
	});

	it("changing the issuer clears the verification", async () => {
		const { services, repository } = makeServices({
			config: { ...activeConfig, verifiedIssuer: ISSUER },
		});
		await updateKeycloakConfig(
			services,
			{ issuerUrl: "https://kc2.example.com/realms/milpia" },
			actor,
		);
		expect(repository.save).toHaveBeenCalledWith(
			expect.objectContaining({ verifiedIssuer: null, verifiedAt: null }),
		);
	});

	it("refuses to change the issuer while in sso-only", async () => {
		const { services } = makeServices({
			config: { ...activeConfig, mode: "sso-only", verifiedIssuer: ISSUER },
		});
		await expectError(
			updateKeycloakConfig(
				services,
				{ issuerUrl: "https://kc2.example.com/realms/milpia" },
				actor,
			),
			"issuer_change_in_sso_only",
		);
	});

	it("NFR-SEC-004: refuses plain HTTP without the explicit flag", async () => {
		const { services } = makeServices();
		await expectError(
			updateKeycloakConfig(
				services,
				{ issuerUrl: "http://kc.local/realms/dev" },
				actor,
			),
			"insecure_http",
		);
		await expect(
			updateKeycloakConfig(
				services,
				{ issuerUrl: "http://kc.local/realms/dev", allowInsecureHttp: true },
				actor,
			),
		).resolves.toMatchObject({ allowInsecureHttp: true });
	});

	it("rejects an issuer that is not a URL", async () => {
		const { services } = makeServices();
		await expectError(
			updateKeycloakConfig(services, { issuerUrl: "kc.example.com" }, actor),
			"invalid_issuer",
		);
	});

	it("FR-020: refuses to change env-sourced fields", async () => {
		const { services } = makeServices({
			env: { values: { clientId: "env-client" }, errors: [] },
		});
		await expectError(
			updateKeycloakConfig(services, { clientId: "other" }, actor),
			"env_locked",
		);
	});

	it("FR-020: sending the env value back unchanged is accepted", async () => {
		const { services, repository } = makeServices({
			env: { values: { clientId: "env-client" }, errors: [] },
		});
		await updateKeycloakConfig(
			services,
			{ clientId: "env-client", buttonLabel: "Hola" },
			actor,
		);
		expect(repository.save).toHaveBeenCalledWith({ buttonLabel: "Hola" });
	});

	it("FR-020: an env-forced mode cannot be changed from the UI", async () => {
		const { services } = makeServices({
			env: { values: { mode: "button" }, errors: [] },
		});
		await expectError(
			updateKeycloakConfig(services, { mode: "disabled" }, actor),
			"env_locked",
		);
	});

	it("moving to disabled always works and is logged", async () => {
		const { services, recorded } = makeServices({
			config: { ...activeConfig, mode: "sso-only", verifiedIssuer: ISSUER },
		});
		await updateKeycloakConfig(services, { mode: "disabled" }, actor);
		expect(recorded).toEqual([
			expect.objectContaining({
				type: "mode_change",
				reason: "sso-only->disabled",
				userId: "owner-id",
			}),
		]);
	});

	it("resets the OIDC client so new credentials are used", async () => {
		const { services, oidc } = makeServices();
		await updateKeycloakConfig(services, { clientSecret: "rotated" }, actor);
		expect(oidc.reset).toHaveBeenCalled();
	});
});

describe("testKeycloakConnection (FR-014)", () => {
	it("tests unsaved values, falling back to the stored secret", async () => {
		const { services, oidc } = makeServices();
		await testKeycloakConnection(services, {
			issuerUrl: "https://kc2.example.com/realms/x/",
		});
		expect(oidc.testConnection).toHaveBeenCalledWith({
			issuerUrl: "https://kc2.example.com/realms/x",
			clientId: "dokploy",
			clientSecret: "secret",
			allowInsecureHttp: false,
		});
	});

	it("reports missing fields without calling Keycloak", async () => {
		const { services, oidc } = makeServices({ config: DEFAULT_STORED_CONFIG });
		await expect(testKeycloakConnection(services, {})).resolves.toMatchObject({
			ok: false,
		});
		expect(oidc.testConnection).not.toHaveBeenCalled();
	});
});

describe("getPublicConfig", () => {
	it("FR-003: exposes only the effective mode and the button label", async () => {
		const { services } = makeServices();
		await expect(getPublicConfig(services)).resolves.toEqual({
			mode: "button",
			buttonLabel: "Sign in with Keycloak",
		});
	});

	it("SC-006: reports disabled when inactive", async () => {
		const { services } = makeServices({ config: DEFAULT_STORED_CONFIG });
		await expect(getPublicConfig(services)).resolves.toMatchObject({
			mode: "disabled",
		});
	});
});
