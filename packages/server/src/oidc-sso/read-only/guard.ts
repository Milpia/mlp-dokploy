import { type AuthEventInput, newCorrelationId } from "../events/auth-events";
import { memberProfileCache, type ReadOnlySets } from "../member-profile/cache";
import {
	getReadOnlyScope,
	isReadOnlyEmpty,
} from "../member-profile/read-only-scope";
import { drizzleSubResourceOwner } from "./lookup";
import {
	evaluate,
	type ReadOnlyDecision,
	type ReadOnlyRule,
	resolveRule,
	SECRET_QUERY_POLICY,
	type SubResource,
} from "./policy";

export interface ReadOnlyGuardDeps {
	isProfiled(userId: string): boolean;
	getScope(userId: string): Promise<ReadOnlySets>;
	ownerOf(resource: SubResource, id: string): Promise<string | null>;
	record(event: AuthEventInput): Promise<void>;
}

export const defaultReadOnlyGuardDeps = (services: {
	events: { record(event: AuthEventInput): Promise<void> };
}): ReadOnlyGuardDeps => ({
	isProfiled: (userId) => memberProfileCache.has(userId),
	getScope: (userId) => getReadOnlyScope(userId),
	ownerOf: (resource, id) => drizzleSubResourceOwner.ownerOf(resource, id),
	record: (event) => services.events.record(event),
});

export interface ReadOnlyCall {
	user: { id: string; role?: string | null } | null | undefined;
	path: string;
	type: string;
	getRawInput: () => Promise<unknown>;
}

/**
 * What the tRPC guard does with a call (spec 006, contracts/guard-and-redaction.md):
 * `pass` without reading anything, `deny`, or `allow` a mutation or a query,
 * which then gets its secrets masked with `scope`.
 */
export type ReadOnlyVerdict =
	| { kind: "pass" }
	| { kind: "deny"; resourceId?: string }
	| { kind: "allow"; scope: ReadOnlySets };

const settle = async (
	decision: ReadOnlyDecision,
	scope: ReadOnlySets,
	deps: ReadOnlyGuardDeps,
): Promise<ReadOnlyVerdict> => {
	if ("lookup" in decision) {
		const owner = await deps.ownerOf(decision.lookup, decision.id);
		if (owner === null) return { kind: "deny" };
		return scope.serviceIds.has(owner)
			? { kind: "deny", resourceId: owner }
			: { kind: "allow", scope };
	}
	return decision.allow
		? { kind: "allow", scope }
		: { kind: "deny", resourceId: decision.resourceId };
};

export const checkReadOnlyCall = async (
	call: ReadOnlyCall,
	deps: ReadOnlyGuardDeps,
): Promise<ReadOnlyVerdict> => {
	const { user } = call;
	if (user?.role !== "member") return { kind: "pass" };
	if (!deps.isProfiled(user.id)) return { kind: "pass" };
	const scope = await deps.getScope(user.id);
	if (isReadOnlyEmpty(scope)) return { kind: "pass" };

	let rule: ReadOnlyRule | undefined;
	if (call.type === "query") {
		rule = SECRET_QUERY_POLICY[call.path];
		if (!rule) return { kind: "allow", scope };
	} else {
		rule = resolveRule(call.path);
		if (!rule) return { kind: "deny" };
	}
	return settle(evaluate(rule, await call.getRawInput(), scope), scope, deps);
};

export const readOnlyEvent = (
	call: ReadOnlyCall,
	outcome: "denied" | "error",
	resourceId?: string,
): AuthEventInput => ({
	type: "member_profile",
	outcome,
	reason: outcome === "denied" ? "read_only" : "read_only_check_failed",
	correlationId: newCorrelationId(),
	...(call.user ? { userId: call.user.id } : {}),
	action: call.path,
	...(resourceId ? { resourceId } : {}),
});
