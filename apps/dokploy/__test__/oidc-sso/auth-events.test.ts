import {
	AuthEventRecorder,
	type AuthEventStore,
	newCorrelationId,
} from "@dokploy/server/oidc-sso/events/auth-events";
import { describe, expect, it, vi } from "vitest";

const store = (): AuthEventStore & {
	insert: ReturnType<typeof vi.fn>;
	listRecent: ReturnType<typeof vi.fn>;
	count: ReturnType<typeof vi.fn>;
	deleteOlderThan: ReturnType<typeof vi.fn>;
} => ({
	insert: vi.fn(async () => {}),
	listRecent: vi.fn(async () => []),
	count: vi.fn(async () => 0),
	deleteOlderThan: vi.fn(async () => {}),
});

const event = {
	type: "sso_login" as const,
	outcome: "denied" as const,
	reason: "not_in_access_group",
	email: "dev@example.com",
	correlationId: "ABC",
};

const DAY = 24 * 60 * 60 * 1000;

describe("AuthEventRecorder (FR-013)", () => {
	it("stores the event", async () => {
		const s = store();
		await new AuthEventRecorder(s).record(event);
		expect(s.insert).toHaveBeenCalledWith(event);
	});

	it("never throws when the store fails", async () => {
		const s = store();
		s.insert.mockRejectedValueOnce(new Error("db down"));
		const logError = vi.fn();
		await expect(
			new AuthEventRecorder(s, { logError }).record(event),
		).resolves.toBeUndefined();
		expect(logError).toHaveBeenCalled();
	});

	it("prunes events older than 90 days at most once per hour", async () => {
		const s = store();
		let clock = 100 * DAY;
		const recorder = new AuthEventRecorder(s, { now: () => clock });
		await recorder.record(event);
		await recorder.record(event);
		expect(s.deleteOlderThan).toHaveBeenCalledTimes(1);
		expect(s.deleteOlderThan).toHaveBeenCalledWith(new Date(10 * DAY));

		clock += 60 * 60 * 1000 + 1;
		await recorder.record(event);
		expect(s.deleteOlderThan).toHaveBeenCalledTimes(2);
	});

	it("swallows pruning failures", async () => {
		const s = store();
		s.deleteOlderThan.mockRejectedValueOnce(new Error("locked"));
		const logError = vi.fn();
		await expect(
			new AuthEventRecorder(s, { logError }).record(event),
		).resolves.toBeUndefined();
		expect(logError).toHaveBeenCalledTimes(1);
	});

	it("clamps listRecent between 1 and 100", async () => {
		const s = store();
		const recorder = new AuthEventRecorder(s);
		await recorder.listRecent(500);
		await recorder.listRecent(0);
		await recorder.listRecent();
		expect(s.listRecent.mock.calls).toEqual([[100], [1], [50]]);
	});

	it("pages newest first and returns the total", async () => {
		const s = store();
		s.count.mockResolvedValue(45);
		const recorder = new AuthEventRecorder(s);
		await expect(recorder.listPage(3, 20)).resolves.toEqual({
			items: [],
			total: 45,
			page: 3,
			pageSize: 20,
		});
		await recorder.listPage();
		await recorder.listPage(0, 500);
		expect(s.listRecent.mock.calls).toEqual([
			[20, 40],
			[20, 0],
			[100, 0],
		]);
	});
});

describe("newCorrelationId (NFR-QA-004)", () => {
	it("returns a 12-character uppercase hex id that differs each time", () => {
		const a = newCorrelationId();
		expect(a).toMatch(/^[0-9A-F]{12}$/);
		expect(newCorrelationId()).not.toBe(a);
	});
});
