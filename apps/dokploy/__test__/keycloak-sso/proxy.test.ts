import { describe, expect, it } from "vitest";
import { dashboardLoginRedirect } from "@/lib/dashboard-return-to";

const at = (path: string) => new URL(`https://dokploy.example.com${path}`);

describe("dashboardLoginRedirect (US2 deep links)", () => {
	it("sends a signed-out dashboard request to the login page with returnTo", () => {
		const target = dashboardLoginRedirect(
			at("/dashboard/project/abc?tab=logs"),
			null,
		);
		expect(target?.pathname).toBe("/");
		expect(target?.searchParams.get("returnTo")).toBe(
			"/dashboard/project/abc?tab=logs",
		);
		expect(target?.origin).toBe("https://dokploy.example.com");
	});

	it("covers /dashboard itself", () => {
		expect(dashboardLoginRedirect(at("/dashboard"), "")).not.toBeNull();
	});

	it("lets requests with a session cookie through", () => {
		for (const cookie of [
			"better-auth.session_token=abc.def",
			"theme=dark; __Secure-better-auth.session_token=abc",
			"better-auth-session_token=abc",
		]) {
			expect(dashboardLoginRedirect(at("/dashboard/home"), cookie)).toBeNull();
		}
	});

	it("ignores look-alike or empty cookies", () => {
		for (const cookie of [
			"better-auth.session_token=",
			"xbetter-auth.session_token=abc",
			"better-auth.session_token_other=abc",
		]) {
			expect(
				dashboardLoginRedirect(at("/dashboard/home"), cookie),
			).not.toBeNull();
		}
	});

	it("does not touch other routes", () => {
		for (const path of [
			"/",
			"/register",
			"/api/auth/get-session",
			"/dashboards",
		]) {
			expect(dashboardLoginRedirect(at(path), null)).toBeNull();
		}
	});
});
