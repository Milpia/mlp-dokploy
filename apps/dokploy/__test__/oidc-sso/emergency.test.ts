import { disableSsoOnlyCommand } from "@dokploy/server/oidc-sso/admin/disable-sso-only";
import { describe, expect, it, vi } from "vitest";
import { activeConfig, ISSUER, makeServices } from "./helpers";

const ssoOnly = {
	...activeConfig,
	mode: "sso-only" as const,
	verifiedIssuer: ISSUER,
};

describe("disableSsoOnlyCommand (FR-012a)", () => {
	it("switches sso-only to button mode and records it", async () => {
		const { services, recorded } = makeServices({ config: ssoOnly });
		await expect(disableSsoOnlyCommand(services)).resolves.toEqual({
			exitCode: 0,
			lines: ["SSO-only mode disabled. The instance is now in button mode."],
		});
		expect((await services.config.getEffective()).mode).toBe("button");
		expect(recorded.at(-1)).toMatchObject({
			type: "mode_change",
			reason: "emergency_command:sso-only->button",
		});
	});

	it("reports that there is nothing to do outside sso-only", async () => {
		const { services, recorded } = makeServices();
		await expect(disableSsoOnlyCommand(services)).resolves.toEqual({
			exitCode: 0,
			lines: ["SSO-only mode was not enabled. Nothing to do."],
		});
		expect(recorded.at(-1)?.reason).toBe("emergency_command:no_change");
	});

	it("FR-021: warns and exits 2 when the environment forces sso-only", async () => {
		const { services } = makeServices({
			config: ssoOnly,
			env: { values: { mode: "sso-only" }, errors: [] },
		});
		const result = await disableSsoOnlyCommand(services);
		expect(result.exitCode).toBe(2);
		expect(result.lines[1]).toContain("SSO_OIDC_MODE=sso-only");
	});

	it("exits 1 when the database cannot be updated", async () => {
		const { services, repository } = makeServices({ config: ssoOnly });
		vi.mocked(repository.save).mockRejectedValueOnce(new Error("db down"));
		await expect(disableSsoOnlyCommand(services)).resolves.toMatchObject({
			exitCode: 1,
		});
	});
});
