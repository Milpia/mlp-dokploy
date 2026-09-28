import { randomBytes } from "node:crypto";
import { db } from "@dokploy/server/db";
import { oidcSsoAuthEvent, user } from "@dokploy/server/db/schema";
import { count, desc, inArray, lt } from "drizzle-orm";
import type {
	AuthEventOutcome,
	AuthEventType,
	UserManagementAction,
} from "../types";

export interface AuthEventInput {
	type: AuthEventType;
	outcome: AuthEventOutcome;
	correlationId: string;
	reason?: string;
	email?: string;
	userId?: string;
	ip?: string;
	/** Set when an emergency login arrived through the emergency origin (spec 003). */
	emergencyOrigin?: boolean;
	/**
	 * A user_management action (spec 002), or the procedure or WebSocket path
	 * of a read-only denial (spec 006).
	 */
	action?: UserManagementAction | (string & {});
	targetUserId?: string;
	/** Service, environment or project of a read-only denial (spec 006). */
	resourceId?: string;
}

export interface AuthEvent extends AuthEventInput {
	id: string;
	createdAt: Date;
	/** Resolved on read; absent when the user no longer exists. */
	userEmail?: string;
	targetUserEmail?: string;
}

export interface AuthEventStore {
	insert(event: AuthEventInput): Promise<void>;
	listRecent(limit: number, offset?: number): Promise<AuthEvent[]>;
	count(): Promise<number>;
	deleteOlderThan(cutoff: Date): Promise<void>;
}

export interface AuthEventPage {
	items: AuthEvent[];
	total: number;
	page: number;
	pageSize: number;
}

const RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Short, unguessable id the user can quote to support (NFR-QA-004). */
export const newCorrelationId = (): string =>
	randomBytes(6).toString("hex").toUpperCase();

export const drizzleAuthEventStore: AuthEventStore = {
	async insert(event) {
		await db.insert(oidcSsoAuthEvent).values(event);
	},
	async listRecent(limit, offset = 0) {
		const rows = await db
			.select()
			.from(oidcSsoAuthEvent)
			.orderBy(desc(oidcSsoAuthEvent.createdAt), desc(oidcSsoAuthEvent.id))
			.limit(limit)
			.offset(offset);
		const ids = [
			...new Set(
				rows.flatMap((row) =>
					[row.userId, row.targetUserId].filter((id): id is string => !!id),
				),
			),
		];
		const emails = new Map(
			ids.length === 0
				? []
				: (
						await db
							.select({ id: user.id, email: user.email })
							.from(user)
							.where(inArray(user.id, ids))
					).map((u) => [u.id, u.email]),
		);
		return rows.map((row) => ({
			id: row.id,
			createdAt: row.createdAt,
			type: row.type as AuthEventType,
			outcome: row.outcome as AuthEventOutcome,
			correlationId: row.correlationId,
			...(row.reason ? { reason: row.reason } : {}),
			...(row.email ? { email: row.email } : {}),
			...(row.userId ? { userId: row.userId } : {}),
			...(row.ip ? { ip: row.ip } : {}),
			...(row.emergencyOrigin ? { emergencyOrigin: true } : {}),
			...(row.action ? { action: row.action } : {}),
			...(row.targetUserId ? { targetUserId: row.targetUserId } : {}),
			...(row.resourceId ? { resourceId: row.resourceId } : {}),
			...(row.userId && emails.has(row.userId)
				? { userEmail: emails.get(row.userId) }
				: {}),
			...(row.targetUserId && emails.has(row.targetUserId)
				? { targetUserEmail: emails.get(row.targetUserId) }
				: {}),
		}));
	},
	async count() {
		const [row] = await db.select({ total: count() }).from(oidcSsoAuthEvent);
		return row?.total ?? 0;
	},
	async deleteOlderThan(cutoff) {
		await db
			.delete(oidcSsoAuthEvent)
			.where(lt(oidcSsoAuthEvent.createdAt, cutoff));
	},
};

export interface AuthEventRecorderOptions {
	now?: () => number;
	logError?: (message: string, error: unknown) => void;
	logEvent?: (line: string) => void;
}

/**
 * One line per denied or failed event, so operators can diagnose from the
 * container log without database access. Emails stay out of the log; the
 * reference lets them find the full row on the events screen (NFR-QA-004).
 */
export const formatAuthEventLine = (event: AuthEventInput): string =>
	[
		"OIDC SSO event",
		`type=${event.type}`,
		`outcome=${event.outcome}`,
		event.reason && `reason=${event.reason}`,
		`ref=${event.correlationId}`,
		event.userId && `user=${event.userId}`,
		event.action && `action=${event.action}`,
		event.targetUserId && `target=${event.targetUserId}`,
		event.resourceId && `resource=${event.resourceId}`,
		event.emergencyOrigin && "via=emergency_origin",
	]
		.filter(Boolean)
		.join(" ");

/**
 * Recording must never break a login: failures are logged and swallowed.
 * Old events are pruned opportunistically, at most once per hour per process.
 */
export class AuthEventRecorder {
	private lastPruneAt = Number.NEGATIVE_INFINITY;
	private readonly now: () => number;
	private readonly logError: (message: string, error: unknown) => void;
	private readonly logEvent: (line: string) => void;

	constructor(
		private readonly store: AuthEventStore,
		options: AuthEventRecorderOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.logError =
			options.logError ?? ((message, error) => console.error(message, error));
		this.logEvent = options.logEvent ?? ((line) => console.warn(line));
	}

	async record(event: AuthEventInput): Promise<void> {
		if (event.outcome !== "success") {
			try {
				this.logEvent(formatAuthEventLine(event));
			} catch {
				// A broken log sink must not break a login either.
			}
		}
		try {
			await this.store.insert(event);
		} catch (error) {
			this.logError("OIDC SSO: could not record auth event", error);
		}
		await this.pruneIfDue();
	}

	listRecent(limit = 50): Promise<AuthEvent[]> {
		return this.store.listRecent(Math.min(Math.max(limit, 1), 100));
	}

	async listPage(page = 1, pageSize = 20): Promise<AuthEventPage> {
		const size = Math.min(Math.max(pageSize, 1), 100);
		const current = Math.max(page, 1);
		const [items, total] = await Promise.all([
			this.store.listRecent(size, (current - 1) * size),
			this.store.count(),
		]);
		return { items, total, page: current, pageSize: size };
	}

	private async pruneIfDue(): Promise<void> {
		const now = this.now();
		if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
		this.lastPruneAt = now;
		try {
			await this.store.deleteOlderThan(
				new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000),
			);
		} catch (error) {
			this.logError("OIDC SSO: could not prune auth events", error);
		}
	}
}
