import { readEnvOverrides } from "@dokploy/server/oidc-sso/config/env";
import { describe, expect, it } from "vitest";

const noFile = () => {
	throw new Error("unexpected file read");
};

describe("readEnvOverrides", () => {
	it("FR-019: returns no overrides when nothing is set", () => {
		const result = readEnvOverrides({}, noFile);
		expect(result.values).toEqual({});
		expect(result.errors).toEqual([]);
	});

	it("FR-019: reads every SSO_OIDC_* variable", () => {
		const result = readEnvOverrides(
			{
				SSO_OIDC_MODE: "sso-only",
				SSO_OIDC_ISSUER_URL: "https://kc.example.com/realms/milpia",
				SSO_OIDC_CLIENT_ID: "dokploy",
				SSO_OIDC_CLIENT_SECRET: "s3cret",
				SSO_OIDC_ACCESS_GROUP: "dokploy-users",
				SSO_OIDC_ADMIN_GROUP: "dokploy-admins",
				SSO_OIDC_BUTTON_LABEL: "Entrar con Milpia",
				SSO_OIDC_ALLOW_INSECURE_HTTP: "false",
				SSO_OIDC_GROUPS_CLAIM: "urn:zitadel:iam:org:project:roles",
				SSO_OIDC_EXTRA_SCOPES: "groups  offline_access",
			},
			noFile,
		);
		expect(result.errors).toEqual([]);
		expect(result.values).toEqual({
			mode: "sso-only",
			issuerUrl: "https://kc.example.com/realms/milpia",
			clientId: "dokploy",
			clientSecret: "s3cret",
			accessGroup: "dokploy-users",
			adminGroup: "dokploy-admins",
			buttonLabel: "Entrar con Milpia",
			allowInsecureHttp: false,
			groupsClaim: "urn:zitadel:iam:org:project:roles",
			extraScopes: "groups offline_access",
		});
	});

	it("FR-019: treats empty and whitespace-only values as unset", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_CLIENT_ID: "", SSO_OIDC_ACCESS_GROUP: "   " },
			noFile,
		);
		expect(result.values).toEqual({});
	});

	it("FR-019: reads the secret from SSO_OIDC_CLIENT_SECRET_FILE and trims it", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_CLIENT_SECRET_FILE: "/run/secrets/kc" },
			(path) => {
				expect(path).toBe("/run/secrets/kc");
				return "from-file\n";
			},
		);
		expect(result.values.clientSecret).toBe("from-file");
	});

	it("FR-019: the inline secret wins over the _FILE variant", () => {
		const result = readEnvOverrides(
			{
				SSO_OIDC_CLIENT_SECRET: "inline",
				SSO_OIDC_CLIENT_SECRET_FILE: "/run/secrets/kc",
			},
			noFile,
		);
		expect(result.values.clientSecret).toBe("inline");
	});

	it("FR-019: an unreadable secret file is reported and ignored", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_CLIENT_SECRET_FILE: "/missing" },
			() => {
				throw new Error("ENOENT");
			},
		);
		expect(result.values.clientSecret).toBeUndefined();
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).not.toContain("ENOENT: s3cret");
	});

	it("rejects an unknown mode and keeps the rest", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_MODE: "always", SSO_OIDC_CLIENT_ID: "dokploy" },
			noFile,
		);
		expect(result.values).toEqual({ clientId: "dokploy" });
		expect(result.errors[0]).toContain("SSO_OIDC_MODE");
	});

	it("rejects an issuer URL that is not http(s)", () => {
		for (const value of [
			"not a url",
			"ftp://kc.example.com",
			"javascript:alert(1)",
		]) {
			const result = readEnvOverrides({ SSO_OIDC_ISSUER_URL: value }, noFile);
			expect(result.values.issuerUrl).toBeUndefined();
			expect(result.errors[0]).toContain("SSO_OIDC_ISSUER_URL");
		}
	});

	it("strips a trailing slash from the issuer URL", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_ISSUER_URL: "https://kc.example.com/realms/milpia/" },
			noFile,
		);
		expect(result.values.issuerUrl).toBe(
			"https://kc.example.com/realms/milpia",
		);
	});

	it("FR-023a: rejects extra scopes with characters outside RFC 6749", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_EXTRA_SCOPES: 'groups "quoted"' },
			noFile,
		);
		expect(result.values.extraScopes).toBeUndefined();
		expect(result.errors[0]).toContain("SSO_OIDC_EXTRA_SCOPES");
	});

	it("rejects a non-boolean SSO_OIDC_ALLOW_INSECURE_HTTP", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_ALLOW_INSECURE_HTTP: "yes" },
			noFile,
		);
		expect(result.values.allowInsecureHttp).toBeUndefined();
		expect(result.errors).toHaveLength(1);
	});

	it("FR-003: rejects a button label longer than 64 characters", () => {
		const result = readEnvOverrides(
			{ SSO_OIDC_BUTTON_LABEL: "x".repeat(65) },
			noFile,
		);
		expect(result.values.buttonLabel).toBeUndefined();
		expect(result.errors).toHaveLength(1);
	});
});
