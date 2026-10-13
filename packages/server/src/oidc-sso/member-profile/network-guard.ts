import { type AuthEventInput, newCorrelationId } from "../events/auth-events";
import type { OidcSsoServices } from "../services";

export const MEMBER_NETWORK_DENIED_MESSAGE =
	"Only owners and admins can change networks.";

/**
 * The network queries reviewed as reads (spec 005, FR-018). Everything else
 * under `network.` is denied to members, so a mutation added by upstream is
 * covered without touching this list.
 */
export const NETWORK_READS: readonly string[] = [
	"network.all",
	"network.one",
	"network.inspect",
	"network.networksToSync",
];

export interface MemberNetworkGuardDeps {
	isSsoActive(): Promise<boolean>;
	record(event: AuthEventInput): Promise<void>;
}

export const defaultMemberNetworkGuardDeps = (
	services: Pick<OidcSsoServices, "config" | "events">,
): MemberNetworkGuardDeps => ({
	isSsoActive: async () => (await services.config.getEffective()).active,
	record: (event) => services.events.record(event),
});

export interface MemberNetworkCall {
	user: { id: string; role?: string | null } | null | undefined;
	path: string;
	type: string;
}

/**
 * Networks belong to the instance, not to a project, so the group scope
 * cannot bind them: a member may look at them and nothing else.
 */
export const isMemberNetworkChange = (call: MemberNetworkCall): boolean =>
	call.user?.role === "member" &&
	call.path.startsWith("network.") &&
	call.type !== "query";

export const memberNetworkEvent = (
	call: MemberNetworkCall,
): AuthEventInput => ({
	type: "member_profile",
	outcome: "denied",
	reason: "network_change",
	correlationId: newCorrelationId(),
	...(call.user ? { userId: call.user.id } : {}),
	action: call.path,
});
