import {
	decideEmergencyOrigin,
	type EmergencyOriginInput,
} from "@dokploy/server/oidc-sso/domain/emergency-origin";
import { describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:3900";
const OWNER = "owner@example.com";

const input = (
	overrides: Partial<EmergencyOriginInput> = {},
): EmergencyOriginInput => ({
	configuredOrigin: ORIGIN,
	method: "POST",
	requestOrigin: ORIGIN,
	path: "/sign-in/email",
	email: OWNER,
	ownerEmail: OWNER,
	...overrides,
});

const keep = { rewrite: false, recordDenied: false };

describe("decideEmergencyOrigin", () => {
	it("FR-004: rewrites the owner's sign-in from the configured origin in sso-only", () => {
		expect(decideEmergencyOrigin(input())).toEqual({ rewrite: true });
	});

	it("FR-004: matches the owner email ignoring case and surrounding spaces", () => {
		expect(
			decideEmergencyOrigin(input({ email: "  Owner@Example.COM " })),
		).toEqual({ rewrite: true });
	});

	it("FR-003: never rewrites without a configured origin", () => {
		expect(decideEmergencyOrigin(input({ configuredOrigin: null }))).toEqual(
			keep,
		);
	});

	it("only rewrites POST requests", () => {
		expect(decideEmergencyOrigin(input({ method: "GET" }))).toEqual(keep);
	});

	it.each([
		"https://localhost:3900",
		"http://localhost:3000",
		"http://127.0.0.1:3900",
		"http://evil.example.com",
	])("FR-004: leaves a different origin (%s) alone", (requestOrigin) => {
		expect(decideEmergencyOrigin(input({ requestOrigin }))).toEqual(keep);
	});

	it("NFR-SEC-002: leaves a request without origin alone", () => {
		expect(decideEmergencyOrigin(input({ requestOrigin: null }))).toEqual(keep);
	});

	it.each([
		"/sign-up/email",
		"/request-password-reset",
		"/change-password",
		"/organization/invite-member",
		"/two-factor/enable",
		"/two-factor/disable",
		"/two-factor/generate-backup-codes",
		"/sign-in/email/extra",
	])("FR-004/FR-005: leaves %s alone", (path) => {
		expect(decideEmergencyOrigin(input({ path }))).toEqual(keep);
	});

	it.each(["/two-factor/verify-totp", "/two-factor/verify-backup-code"])(
		"FR-005: rewrites the second factor step %s",
		(path) => {
			expect(decideEmergencyOrigin(input({ path, email: null }))).toEqual({
				rewrite: true,
			});
		},
	);

	it.each(["/sign-out", "/oidc/sign-out"])(
		"FR-009/MIL-495: rewrites the sign-out %s",
		(path) => {
			expect(decideEmergencyOrigin(input({ path, email: null }))).toEqual({
				rewrite: true,
			});
		},
	);

	it("FR-006: a non-owner sign-in is left alone and flagged for recording", () => {
		expect(decideEmergencyOrigin(input({ email: "dev@example.com" }))).toEqual({
			rewrite: false,
			recordDenied: true,
		});
	});

	it("FR-006: a sign-in without an email is flagged for recording", () => {
		expect(decideEmergencyOrigin(input({ email: null }))).toEqual({
			rewrite: false,
			recordDenied: true,
		});
	});

	it("NFR-SEC-002: without an owner nobody gets the exception", () => {
		expect(decideEmergencyOrigin(input({ ownerEmail: null }))).toEqual({
			rewrite: false,
			recordDenied: true,
		});
	});
});
