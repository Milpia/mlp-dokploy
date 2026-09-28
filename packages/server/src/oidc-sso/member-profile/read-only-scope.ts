import type { ReadOnlyScope } from "../types";
import { type ReadOnlySets, readOnlyScopeCache } from "./cache";
import { findReadOnlyScope, listReadOnlyScopes } from "./store";

export { type ReadOnlySets, readOnlyScopeCache } from "./cache";

export interface ReadOnlyScopeSource {
	find(userId: string): Promise<ReadOnlyScope | null>;
	list(): Promise<Array<ReadOnlyScope & { userId: string }>>;
}

export const drizzleReadOnlyScopeSource: ReadOnlyScopeSource = {
	find: findReadOnlyScope,
	list: listReadOnlyScopes,
};

const EMPTY: ReadOnlySets = {
	environmentIds: new Set(),
	serviceIds: new Set(),
	projectIds: new Set(),
};

const toSets = (scope: ReadOnlyScope | null): ReadOnlySets =>
	scope
		? {
				environmentIds: new Set(scope.environmentIds),
				serviceIds: new Set(scope.serviceIds),
				projectIds: new Set(scope.projectIds),
			}
		: EMPTY;

export const isReadOnlyEmpty = (sets: ReadOnlySets) =>
	sets.environmentIds.size === 0 &&
	sets.serviceIds.size === 0 &&
	sets.projectIds.size === 0;

/**
 * The read-only scope of a profiled user from memory: a full reload every
 * 5 minutes, and one row after a login invalidated the entry. Errors are
 * thrown so the caller denies (NFR-SEC-001).
 */
export const getReadOnlyScope = async (
	userId: string,
	source: ReadOnlyScopeSource = drizzleReadOnlyScopeSource,
	now: number = Date.now(),
): Promise<ReadOnlySets> => {
	if (readOnlyScopeCache.isStale(now)) {
		const rows = await source.list();
		readOnlyScopeCache.replace(
			rows.map(({ userId: id, ...scope }) => [id, toSets(scope)]),
			now,
		);
	}
	const cached = readOnlyScopeCache.get(userId);
	if (cached) return cached;
	const sets = toSets(await source.find(userId));
	readOnlyScopeCache.set(userId, sets);
	return sets;
};
