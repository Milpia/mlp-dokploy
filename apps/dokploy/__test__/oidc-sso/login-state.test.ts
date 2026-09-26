import {
	LOGIN_STATE_MAX_GROUP_LENGTH,
	LOGIN_STATE_MAX_GROUPS,
	normalizeLoginGroups,
} from "@dokploy/server/oidc-sso/identity/login-state";
import { describe, expect, it } from "vitest";

describe("normalizeLoginGroups (spec 002, data-model)", () => {
	it("FR-008: stores bare, deduplicated, sorted group names", () => {
		expect(normalizeLoginGroups(["/b", "a", "/b/", " c "])).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("keeps full paths so path-configured groups still match", () => {
		expect(normalizeLoginGroups(["/teams/dokploy"])).toEqual(["teams/dokploy"]);
	});

	it("drops empty names and names longer than 256 characters", () => {
		expect(LOGIN_STATE_MAX_GROUP_LENGTH).toBe(256);
		expect(
			normalizeLoginGroups(["", "  ", "x".repeat(257), "y".repeat(256)]),
		).toEqual(["y".repeat(256)]);
	});

	it("keeps at most 100 groups, the first ones after sorting", () => {
		expect(LOGIN_STATE_MAX_GROUPS).toBe(100);
		const many = Array.from(
			{ length: 150 },
			(_, i) => `g${String(i).padStart(3, "0")}`,
		).reverse();
		const kept = normalizeLoginGroups(many);
		expect(kept).toHaveLength(100);
		expect(kept[0]).toBe("g000");
		expect(kept.at(-1)).toBe("g099");
	});
});
