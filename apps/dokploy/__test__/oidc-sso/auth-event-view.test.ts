import { describe, expect, it } from "vitest";
import { authEventView } from "@/components/dashboard/settings/oidc-sso/auth-event-view";

describe("authEventView (spec 002 FR-012, US1 scenario 4, MIL-509)", () => {
	it("shows who tried, the action and the affected user of a denied user-management attempt", () => {
		expect(
			authEventView({
				type: "user_management",
				userId: "lead-1",
				userEmail: "lead1@example.com",
				action: "remove_user",
				targetUserId: "dev-1",
				targetUserEmail: "dev1@example.com",
			}),
		).toEqual({
			type: "User management",
			who: "lead1@example.com",
			action: "Delete user",
			target: "dev1@example.com",
		});
	});

	it("falls back to the ids when the users no longer exist", () => {
		expect(
			authEventView({
				type: "user_management",
				userId: "lead-1",
				action: "change_role",
				targetUserId: "dev-1",
			}),
		).toMatchObject({ who: "lead-1", action: "Change role", target: "dev-1" });
	});

	it("leaves the affected user empty for new invitations", () => {
		expect(
			authEventView({
				type: "user_management",
				userEmail: "lead1@example.com",
				userId: "lead-1",
				action: "invite",
			}),
		).toMatchObject({ action: "Invite", target: "" });
	});

	it("keeps the email a sign-in event already carries", () => {
		expect(
			authEventView({
				type: "sso_login",
				email: "a@example.com",
				userId: "u",
				userEmail: "other@example.com",
			}),
		).toEqual({
			type: "SSO sign-in",
			who: "a@example.com",
			action: "",
			target: "",
		});
	});
});
