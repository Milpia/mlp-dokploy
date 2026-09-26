import type { EnvOverrides } from "@dokploy/server/oidc-sso/config/env";
import {
	buildEffectiveConfig,
	SsoConfigProvider,
} from "@dokploy/server/oidc-sso/config/provider";
import {
	type ConfigPatch,
	type ConfigRepository,
	DEFAULT_STORED_CONFIG,
} from "@dokploy/server/oidc-sso/config/repository";
import type { StoredConfig } from "@dokploy/server/oidc-sso/types";
import { describe, expect, it, vi } from "vitest";

const complete: StoredConfig = {
	...DEFAULT_STORED_CONFIG,
	mode: "button",
	issuerUrl: "https://kc.example.com/realms/milpia",
	clientId: "dokploy",
	clientSecret: "secret",
	accessGroup: "dokploy-users",
};

const noEnv: EnvOverrides = { values: {}, errors: [] };
const flags = { isCloud: false, hasEnterpriseLicense: false };

const fakeRepository = (initial: StoredConfig = complete) => {
	let state = { ...initial };
	const repository: ConfigRepository & {
		get: ReturnType<typeof vi.fn>;
		save: ReturnType<typeof vi.fn>;
	} = {
		get: vi.fn(async () => ({ ...state })),
		save: vi.fn(async (patch: ConfigPatch) => {
			state = { ...state, ...patch } as StoredConfig;
			return { ...state };
		}),
	};
	return repository;
};

describe("buildEffectiveConfig", () => {
	it("FR-002: the default configuration is inactive", () => {
		const config = buildEffectiveConfig(DEFAULT_STORED_CONFIG, noEnv, flags);
		expect(config.active).toBe(false);
		expect(config.inactiveReason).toBe("disabled");
	});

	it("FR-001: a complete configuration in button mode is active", () => {
		const config = buildEffectiveConfig(complete, noEnv, flags);
		expect(config.active).toBe(true);
		expect(config.mode).toBe("button");
		expect(config.inactiveReason).toBeUndefined();
	});

	it("marks an incomplete configuration as inactive", () => {
		const config = buildEffectiveConfig(
			{ ...complete, clientSecret: null },
			noEnv,
			flags,
		);
		expect(config.active).toBe(false);
		expect(config.inactiveReason).toBe("incomplete");
	});

	it("is never active on cloud", () => {
		const config = buildEffectiveConfig(complete, noEnv, {
			...flags,
			isCloud: true,
		});
		expect(config.active).toBe(false);
		expect(config.inactiveReason).toBe("cloud");
	});

	it("FR-017: steps aside when an enterprise license is active", () => {
		const config = buildEffectiveConfig(complete, noEnv, {
			...flags,
			hasEnterpriseLicense: true,
		});
		expect(config.active).toBe(false);
		expect(config.inactiveReason).toBe("enterprise");
	});

	it("FR-019/FR-020: environment values win and are reported as env-sourced", () => {
		const config = buildEffectiveConfig(
			complete,
			{
				values: { clientId: "from-env", accessGroup: "env-group" },
				errors: [],
			},
			flags,
		);
		expect(config.clientId).toBe("from-env");
		expect(config.accessGroup).toBe("env-group");
		expect(config.sources.clientId).toBe("env");
		expect(config.sources.accessGroup).toBe("env");
		expect(config.sources.issuerUrl).toBe("db");
	});

	it("spec 002 FR-001: the user-management group from env wins and is env-sourced", () => {
		const config = buildEffectiveConfig(
			{ ...complete, userManagementGroup: "stored" },
			{ values: { userManagementGroup: "admins" }, errors: [] },
			flags,
		);
		expect(config.userManagementGroup).toBe("admins");
		expect(config.sources.userManagementGroup).toBe("env");
	});

	it("spec 002 FR-009: the user-management group defaults to unset", () => {
		const config = buildEffectiveConfig(
			complete,
			{ values: {}, errors: [] },
			flags,
		);
		expect(config.userManagementGroup ?? null).toBeNull();
		expect(config.sources.userManagementGroup).toBe("db");
	});

	it("FR-011: sso-only without a verified issuer degrades to button", () => {
		const config = buildEffectiveConfig(
			{ ...complete, mode: "sso-only" },
			{ values: {}, errors: [] },
			flags,
		);
		expect(config.mode).toBe("button");
		expect(config.verified).toBe(false);
	});

	it("FR-011: an env-forced sso-only without verification also degrades", () => {
		const config = buildEffectiveConfig(
			complete,
			{ values: { mode: "sso-only" }, errors: [] },
			flags,
		);
		expect(config.mode).toBe("button");
	});

	it("FR-011: sso-only with the current issuer verified stays sso-only", () => {
		const config = buildEffectiveConfig(
			{ ...complete, mode: "sso-only", verifiedIssuer: complete.issuerUrl },
			noEnv,
			flags,
		);
		expect(config.mode).toBe("sso-only");
		expect(config.verified).toBe(true);
	});

	it("FR-011: verification does not carry over to a different issuer", () => {
		const config = buildEffectiveConfig(
			{
				...complete,
				mode: "sso-only",
				verifiedIssuer: "https://old.example.com/realms/x",
			},
			noEnv,
			flags,
		);
		expect(config.verified).toBe(false);
		expect(config.mode).toBe("button");
	});
});

describe("SsoConfigProvider", () => {
	const create = (repository = fakeRepository(), now = () => 0) =>
		new SsoConfigProvider({
			repository,
			env: noEnv,
			isCloud: false,
			hasEnterpriseLicense: async () => false,
			now,
		});

	it("NFR-PERF-005: serves repeated reads from the cache", async () => {
		const repository = fakeRepository();
		const provider = create(repository);
		await provider.getEffective();
		await provider.getEffective();
		expect(repository.get).toHaveBeenCalledTimes(1);
	});

	it("NFR-PERF-005: concurrent reads share a single load", async () => {
		const repository = fakeRepository();
		const provider = create(repository);
		await Promise.all(
			Array.from({ length: 20 }, () => provider.getEffective()),
		);
		expect(repository.get).toHaveBeenCalledTimes(1);
	});

	it("NFR-PERF-005: reloads after the 5 s TTL", async () => {
		const repository = fakeRepository();
		let clock = 0;
		const provider = create(repository, () => clock);
		await provider.getEffective();
		clock = 4_999;
		await provider.getEffective();
		expect(repository.get).toHaveBeenCalledTimes(1);
		clock = 5_001;
		await provider.getEffective();
		expect(repository.get).toHaveBeenCalledTimes(2);
	});

	it("FR-018: saving invalidates the cache immediately", async () => {
		const repository = fakeRepository();
		const provider = create(repository);
		expect((await provider.getEffective()).buttonLabel).toBe(
			"Sign in with SSO",
		);
		await provider.save({ buttonLabel: "Entrar" });
		expect((await provider.getEffective()).buttonLabel).toBe("Entrar");
	});

	it("does not cache a failed load", async () => {
		const repository = fakeRepository();
		repository.get.mockRejectedValueOnce(new Error("db down"));
		const provider = create(repository);
		await expect(provider.getEffective()).rejects.toThrow("db down");
		await expect(provider.getEffective()).resolves.toMatchObject({
			active: true,
		});
	});

	it("FR-011: markVerified records the issuer and time", async () => {
		const repository = fakeRepository();
		const provider = create(repository, () => 1_000);
		await provider.markVerified("https://kc.example.com/realms/milpia");
		expect(repository.save).toHaveBeenCalledWith({
			verifiedIssuer: "https://kc.example.com/realms/milpia",
			verifiedAt: new Date(1_000),
		});
	});

	it("FR-012a: disableSsoOnlyMode moves sso-only to button", async () => {
		const repository = fakeRepository({ ...complete, mode: "sso-only" });
		const provider = create(repository);
		await expect(provider.disableSsoOnlyMode()).resolves.toEqual({
			changed: true,
			forcedByEnv: false,
		});
		expect(repository.save).toHaveBeenCalledWith({ mode: "button" });
	});

	it("FR-012a: disableSsoOnlyMode is a no-op outside sso-only", async () => {
		const repository = fakeRepository();
		const provider = create(repository);
		await expect(provider.disableSsoOnlyMode()).resolves.toEqual({
			changed: false,
			forcedByEnv: false,
		});
		expect(repository.save).not.toHaveBeenCalled();
	});

	it("FR-021: disableSsoOnlyMode reports an env-forced mode", async () => {
		const provider = new SsoConfigProvider({
			repository: fakeRepository(),
			env: { values: { mode: "sso-only" }, errors: [] },
			isCloud: false,
			hasEnterpriseLicense: async () => false,
		});
		await expect(provider.disableSsoOnlyMode()).resolves.toMatchObject({
			forcedByEnv: true,
		});
	});

	it("getStored returns the raw stored values, bypassing env overrides", async () => {
		const provider = new SsoConfigProvider({
			repository: fakeRepository(),
			env: { values: { clientId: "env" }, errors: [] },
			isCloud: false,
			hasEnterpriseLicense: async () => false,
		});
		expect((await provider.getStored()).clientId).toBe("dokploy");
	});
});
