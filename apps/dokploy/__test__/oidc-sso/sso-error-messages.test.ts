import { LOGIN_ERROR_CODES } from "@dokploy/server/oidc-sso/types";
import { describe, expect, it } from "vitest";
import { SSO_ERROR_MESSAGES } from "@/lib/oidc-sso";

describe("login screen SSO messages (spec 001 NFR-QA-004)", () => {
	it("every login error code has a message", () => {
		expect(Object.keys(SSO_ERROR_MESSAGES).sort()).toEqual(
			[...LOGIN_ERROR_CODES].sort(),
		);
	});

	it("MIL-508: an identity mismatch neither blames groups nor reveals the account (NFR-SEC-006)", () => {
		const message = SSO_ERROR_MESSAGES.sso_identity_mismatch;
		expect(message).toMatch(/administrator/i);
		expect(message).not.toMatch(/group|linked|already|exists|another/i);
	});
});
