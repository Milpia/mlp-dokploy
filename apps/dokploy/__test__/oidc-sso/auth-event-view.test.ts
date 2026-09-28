import { describe, expect, it } from "vitest";
import {
	authEventView,
	DEFAULT_EVENT_PAGE_SIZE,
	EVENT_PAGE_SIZES,
	eventPagination,
} from "@/components/dashboard/settings/oidc-sso/auth-event-view";

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

describe("authEventView of read-only denials (spec 006, FR-011)", () => {
	it("shows the procedure as the action and the resource as the target", () => {
		expect(
			authEventView({
				type: "member_profile",
				userId: "qa-1",
				userEmail: "qa1@example.com",
				action: "application.deploy",
				resourceId: "app-1",
			}),
		).toEqual({
			type: "Group profile",
			who: "qa1@example.com",
			action: "application.deploy",
			target: "app-1",
		});
	});
});

describe("eventPagination (spec 001 FR-013, events dialog)", () => {
	it("describes a middle page", () => {
		expect(eventPagination(45, 2, 20)).toEqual({
			pageCount: 3,
			from: 21,
			to: 40,
			canPrevious: true,
			canNext: true,
		});
	});

	it("ends the last page at the total", () => {
		expect(eventPagination(45, 3, 20)).toMatchObject({
			from: 41,
			to: 45,
			canNext: false,
		});
	});

	it("has a single page and nothing to move to when empty", () => {
		expect(eventPagination(0, 1, 20)).toEqual({
			pageCount: 1,
			from: 0,
			to: 0,
			canPrevious: false,
			canNext: false,
		});
	});
});

describe("events page size (spec 001 FR-013, T063, MIL-512)", () => {
	it("offers 10, 20 and 50 rows and starts at 10", () => {
		expect(EVENT_PAGE_SIZES).toEqual([10, 20, 50]);
		expect(DEFAULT_EVENT_PAGE_SIZE).toBe(10);
	});

	it("splits 14 events into two pages at the default size", () => {
		expect(eventPagination(14, 1, DEFAULT_EVENT_PAGE_SIZE)).toEqual({
			pageCount: 2,
			from: 1,
			to: 10,
			canPrevious: false,
			canNext: true,
		});
		expect(eventPagination(14, 2, DEFAULT_EVENT_PAGE_SIZE)).toMatchObject({
			from: 11,
			to: 14,
			canNext: false,
		});
	});

	it.each([
		[20, 1],
		[50, 1],
	])("fits 14 events in one page of %i", (size, pages) => {
		expect(eventPagination(14, 1, size).pageCount).toBe(pages);
	});
});
