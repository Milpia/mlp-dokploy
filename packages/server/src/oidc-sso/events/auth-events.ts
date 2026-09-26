import { randomBytes } from "node:crypto";
import { db } from "@dokploy/server/db";
import { oidcSsoAuthEvent } from "@dokploy/server/db/schema";
import { desc, lt } from "drizzle-orm";
import type { AuthEventOutcome, AuthEventType } from "../types";

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
}

export interface AuthEvent extends AuthEventInput {
	id: string;
	createdAt: Date;
}

export interface AuthEventStore {
	insert(event: AuthEventInput): Promise<void>;
	listRecent(limit: number): Promise<AuthEvent[]>;
	deleteOlderThan(cutoff: Date): Promise<void>;
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
	async listRecent(limit) {
		const rows = await db
			.select()
			.from(oidcSsoAuthEvent)
			.orderBy(desc(oidcSsoAuthEvent.createdAt))
			.limit(limit);
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
		}));
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
}

/**
 * Recording must never break a login: failures are logged and swallowed.
 * Old events are pruned opportunistically, at most once per hour per process.
 */
export class AuthEventRecorder {
	private lastPruneAt = Number.NEGATIVE_INFINITY;
	private readonly now: () => number;
	private readonly logError: (message: string, error: unknown) => void;

	constructor(
		private readonly store: AuthEventStore,
		options: AuthEventRecorderOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.logError =
			options.logError ?? ((message, error) => console.error(message, error));
	}

	async record(event: AuthEventInput): Promise<void> {
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
