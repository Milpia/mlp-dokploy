/**
 * Users that may hold a group profile, so the expiry guard can skip every
 * other member without a query (spec 005, research R6). It is a superset on
 * purpose: ids are added on every grant, even inside a transaction that may
 * roll back, and only a reload removes them. A stale id costs one query; a
 * missing id would skip the expiry check, so removal never happens eagerly.
 */
const RELOAD_INTERVAL_MS = 5 * 60 * 1000;

let ids = new Set<string>();
let loadedAt = Number.NEGATIVE_INFINITY;

export const memberProfileCache = {
	add(userId: string) {
		ids.add(userId);
	},
	has(userId: string) {
		return ids.has(userId);
	},
	isStale(now: number) {
		return now - loadedAt >= RELOAD_INTERVAL_MS;
	},
	replace(userIds: Iterable<string>, now: number) {
		ids = new Set(userIds);
		loadedAt = now;
	},
	/** Tests only. */
	reset() {
		ids = new Set();
		loadedAt = Number.NEGATIVE_INFINITY;
	},
};
