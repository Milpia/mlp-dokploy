import {
	DEFAULT_RETURN_TO,
	sanitizeReturnTo,
} from "@dokploy/server/keycloak-sso/domain/return-to";
import { describe, expect, it } from "vitest";

describe("sanitizeReturnTo (NFR-SEC-003)", () => {
	it("keeps internal paths with query and hash", () => {
		expect(sanitizeReturnTo("/dashboard/projects")).toBe("/dashboard/projects");
		expect(sanitizeReturnTo("/dashboard/project/abc?tab=logs#top")).toBe(
			"/dashboard/project/abc?tab=logs#top",
		);
	});

	it("falls back for missing or non-string values", () => {
		for (const value of [undefined, null, 42, ["/dashboard"], {}, ""]) {
			expect(sanitizeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
		}
	});

	it("rejects absolute and protocol-relative URLs", () => {
		for (const value of [
			"https://evil.example.com",
			"http://evil.example.com/dashboard",
			"//evil.example.com",
			"///evil.example.com",
			"/\\evil.example.com",
			"\\\\evil.example.com",
			"javascript:alert(1)",
			"data:text/html,x",
			"dashboard/projects",
		]) {
			expect(sanitizeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
		}
	});

	it("rejects encoded and whitespace tricks", () => {
		for (const value of [
			"/%2F%2Fevil.example.com",
			"/%5Cevil.example.com",
			"/\t/evil.example.com",
			" /dashboard",
			"/dashboard\n",
			"/%0d%0aSet-Cookie:x=y",
		]) {
			expect(sanitizeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
		}
	});

	it("rejects API routes to avoid redirect loops", () => {
		expect(sanitizeReturnTo("/api/auth/keycloak/sign-in")).toBe(
			DEFAULT_RETURN_TO,
		);
	});

	it("rejects overly long values", () => {
		expect(sanitizeReturnTo(`/dashboard/${"a".repeat(3000)}`)).toBe(
			DEFAULT_RETURN_TO,
		);
	});

	it("uses the provided fallback", () => {
		expect(sanitizeReturnTo("https://evil", "/")).toBe("/");
	});
});
