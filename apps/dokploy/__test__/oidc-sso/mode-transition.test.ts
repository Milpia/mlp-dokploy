import { canTransitionMode } from "@dokploy/server/oidc-sso/domain/mode-transition";
import { describe, expect, it } from "vitest";

const ready = { complete: true, verified: true, issuerChanged: false };

describe("canTransitionMode", () => {
	it("FR-002: moving to disabled is always allowed", () => {
		for (const from of ["disabled", "button", "sso-only"] as const) {
			expect(
				canTransitionMode(from, "disabled", {
					complete: false,
					verified: false,
					issuerChanged: true,
				}),
			).toEqual({ ok: true });
		}
	});

	it("FR-001: button mode needs a complete configuration", () => {
		expect(
			canTransitionMode("disabled", "button", { ...ready, complete: false }),
		).toEqual({ ok: false, reason: "incomplete" });
		expect(canTransitionMode("disabled", "button", ready)).toEqual({
			ok: true,
		});
	});

	it("FR-011: sso-only needs a verified issuer", () => {
		expect(
			canTransitionMode("button", "sso-only", { ...ready, verified: false }),
		).toEqual({ ok: false, reason: "unverified" });
		expect(canTransitionMode("button", "sso-only", ready)).toEqual({
			ok: true,
		});
	});

	it("FR-011: sso-only needs a complete configuration first", () => {
		expect(
			canTransitionMode("button", "sso-only", {
				complete: false,
				verified: true,
				issuerChanged: false,
			}),
		).toEqual({ ok: false, reason: "incomplete" });
	});

	it("rejects changing the issuer while staying in sso-only", () => {
		expect(
			canTransitionMode("sso-only", "sso-only", {
				...ready,
				issuerChanged: true,
			}),
		).toEqual({ ok: false, reason: "issuer_change_in_sso_only" });
	});

	it("allows editing other fields while in sso-only", () => {
		expect(canTransitionMode("sso-only", "sso-only", ready)).toEqual({
			ok: true,
		});
	});

	it("a changed issuer is never verified, so button → sso-only is refused", () => {
		expect(
			canTransitionMode("button", "sso-only", {
				complete: true,
				verified: true,
				issuerChanged: true,
			}),
		).toEqual({ ok: false, reason: "unverified" });
	});
});
