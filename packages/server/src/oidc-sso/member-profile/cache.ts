const RELOAD_INTERVAL_MS = 5 * 60 * 1000;

export interface ReadOnlySets {
	environmentIds: ReadonlySet<string>;
	serviceIds: ReadonlySet<string>;
	projectIds: ReadonlySet<string>;
}

interface CacheState {
	profiledIds: Set<string>;
	profiledLoadedAt: number;
	readOnly: Map<string, ReadOnlySets>;
	readOnlyLoadedAt: number;
	readOnlyVersion: number;
}

const emptyState = (): CacheState => ({
	profiledIds: new Set(),
	profiledLoadedAt: Number.NEGATIVE_INFINITY,
	readOnly: new Map(),
	readOnlyLoadedAt: Number.NEGATIVE_INFINITY,
	readOnlyVersion: 0,
});

// The auth instance is shared across bundles (Next.js API routes, pages and
// the custom server), so the SSO login runs the store of whichever bundle
// created it. Keeping the caches on globalThis makes its invalidation reach
// the copy the tRPC guard and the WebSocket checks read.
const globalForCache = globalThis as unknown as {
	oidcSsoMemberProfileCache?: CacheState;
};

const state = (): CacheState => {
	if (!globalForCache.oidcSsoMemberProfileCache) {
		globalForCache.oidcSsoMemberProfileCache = emptyState();
	}
	return globalForCache.oidcSsoMemberProfileCache;
};

/**
 * Users that may hold a group profile, so the expiry guard can skip every
 * other member without a query (spec 005, research R6). It is a superset on
 * purpose: ids are added on every grant, even inside a transaction that may
 * roll back, and only a reload removes them. A stale id costs one query; a
 * missing id would skip the expiry check, so removal never happens eagerly.
 */
export const memberProfileCache = {
	add(userId: string) {
		state().profiledIds.add(userId);
	},
	has(userId: string) {
		return state().profiledIds.has(userId);
	},
	isStale(now: number) {
		return now - state().profiledLoadedAt >= RELOAD_INTERVAL_MS;
	},
	replace(userIds: Iterable<string>, now: number) {
		const s = state();
		s.profiledIds = new Set(userIds);
		s.profiledLoadedAt = now;
	},
	/** Tests only. */
	reset() {
		const s = state();
		s.profiledIds = new Set();
		s.profiledLoadedAt = Number.NEGATIVE_INFINITY;
	},
};

/**
 * Read-only scope per profiled user (spec 006, research R3). Writes only
 * invalidate an entry, so a login whose transaction rolls back can never
 * leave a scope in memory that the database does not hold. Every
 * invalidation bumps a version, and a read that started before one is not
 * stored: it may hold the row as it was before the commit.
 */
export const readOnlyScopeCache = {
	get(userId: string) {
		return state().readOnly.get(userId);
	},
	set(userId: string, sets: ReadOnlySets) {
		state().readOnly.set(userId, sets);
	},
	invalidate(userId: string) {
		const s = state();
		s.readOnly.delete(userId);
		s.readOnlyVersion += 1;
	},
	version() {
		return state().readOnlyVersion;
	},
	isStale(now: number) {
		return now - state().readOnlyLoadedAt >= RELOAD_INTERVAL_MS;
	},
	replace(entries: Iterable<[string, ReadOnlySets]>, now: number) {
		const s = state();
		s.readOnly = new Map(entries);
		s.readOnlyLoadedAt = now;
	},
	/** Tests only. */
	reset() {
		const s = state();
		s.readOnly = new Map();
		s.readOnlyLoadedAt = Number.NEGATIVE_INFINITY;
		s.readOnlyVersion = 0;
	},
};
