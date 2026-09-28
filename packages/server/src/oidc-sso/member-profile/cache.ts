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

export interface ReadOnlySets {
	environmentIds: ReadonlySet<string>;
	serviceIds: ReadonlySet<string>;
	projectIds: ReadonlySet<string>;
}

let readOnly = new Map<string, ReadOnlySets>();
let readOnlyLoadedAt = Number.NEGATIVE_INFINITY;

/**
 * Read-only scope per profiled user (spec 006, research R3). Writes only
 * invalidate an entry, so a login whose transaction rolls back can never
 * leave a scope in memory that the database does not hold.
 */
export const readOnlyScopeCache = {
	get(userId: string) {
		return readOnly.get(userId);
	},
	set(userId: string, sets: ReadOnlySets) {
		readOnly.set(userId, sets);
	},
	invalidate(userId: string) {
		readOnly.delete(userId);
	},
	isStale(now: number) {
		return now - readOnlyLoadedAt >= RELOAD_INTERVAL_MS;
	},
	replace(entries: Iterable<[string, ReadOnlySets]>, now: number) {
		readOnly = new Map(entries);
		readOnlyLoadedAt = now;
	},
	/** Tests only. */
	reset() {
		readOnly = new Map();
		readOnlyLoadedAt = Number.NEGATIVE_INFINITY;
	},
};
