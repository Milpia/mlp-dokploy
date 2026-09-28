import type { ReadOnlySets } from "@dokploy/server/oidc-sso/member-profile/cache";
import {
	type ReadOnlyGuardDeps,
	readOnlyEvent,
} from "@dokploy/server/oidc-sso/read-only/guard";
import {
	READ_ONLY_DENIED_MESSAGE,
	REDACTED_VALUE,
} from "@dokploy/server/oidc-sso/types";
import { describe, expect, it, vi } from "vitest";
import { createReadOnlyGuard } from "@/server/api/middlewares/read-only";

const sets = (
	environmentIds: string[] = [],
	serviceIds: string[] = [],
	projectIds: string[] = [],
): ReadOnlySets => ({
	environmentIds: new Set(environmentIds),
	serviceIds: new Set(serviceIds),
	projectIds: new Set(projectIds),
});

// The developer of quickstart: production read-only, staging full.
const DEVELOPER = sets(["env-prod"], ["app-prod"], ["project-1"]);

const deps = (overrides: Partial<ReadOnlyGuardDeps> = {}) => {
	const d = {
		isProfiled: vi.fn(() => true),
		getScope: vi.fn(async () => DEVELOPER),
		ownerOf: vi.fn(async () => "app-prod" as string | null),
		record: vi.fn(async () => {}),
		...overrides,
	};
	return d;
};

const member = { id: "dev-1", role: "member" };

const call = async (
	d: ReturnType<typeof deps>,
	{
		path = "application.deploy",
		type = "mutation",
		input = { applicationId: "app-prod" } as unknown,
		user = member as { id: string; role?: string | null } | null,
		next = vi.fn(async (): Promise<unknown> => ({ ok: true, data: "done" })),
	}: {
		path?: string;
		type?: string;
		input?: unknown;
		user?: { id: string; role?: string | null } | null;
		next?: () => Promise<unknown>;
	} = {},
) => {
	const guard = createReadOnlyGuard(() => d);
	const result = await guard({
		ctx: { user },
		path,
		type,
		getRawInput: async () => input,
		next,
	});
	return { result, next };
};

describe("readOnlyGuard (spec 006, FR-003, FR-005, FR-009, FR-011, NFR-SEC-001)", () => {
	it("1. FR-009: a user who is not a member goes straight to next, with no cache read", async () => {
		const d = deps();
		for (const role of ["owner", "admin"]) {
			const { next } = await call(d, { user: { id: "a", role } });
			expect(next).toHaveBeenCalled();
		}
		expect(d.isProfiled).not.toHaveBeenCalled();
		expect(d.getScope).not.toHaveBeenCalled();
	});

	it("2. FR-009: a member without a profile goes straight to next", async () => {
		const d = deps({ isProfiled: vi.fn(() => false) });
		const { next } = await call(d);
		expect(next).toHaveBeenCalled();
		expect(d.getScope).not.toHaveBeenCalled();
	});

	it("3. FR-012: a profiled member without read-only goes straight to next", async () => {
		const d = deps({ getScope: vi.fn(async () => sets()) });
		const { next } = await call(d);
		expect(next).toHaveBeenCalled();
	});

	it("4. FR-003: a mutation on a read-only service is refused and recorded", async () => {
		const d = deps();
		const next = vi.fn();
		await expect(call(d, { next })).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: READ_ONLY_DENIED_MESSAGE,
		});
		expect(next).not.toHaveBeenCalled();
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "member_profile",
				outcome: "denied",
				reason: "read_only",
				userId: "dev-1",
				action: "application.deploy",
				resourceId: "app-prod",
			}),
		);
	});

	it("4. US2-3: a mutation on a service with full access goes through", async () => {
		const d = deps();
		const { next } = await call(d, { input: { applicationId: "app-staging" } });
		expect(next).toHaveBeenCalled();
		expect(d.record).not.toHaveBeenCalled();
	});

	it("4. FR-005: a mutation without a rule is refused", async () => {
		await expect(
			call(deps(), { path: "brandNew.thing", input: {} }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("4. a subscription is evaluated like a mutation", async () => {
		await expect(
			call(deps(), {
				path: "postgres.deployWithLogs",
				type: "subscription",
				input: { postgresId: "app-prod" },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("4. a sub-resource is resolved to its owner service", async () => {
		const d = deps();
		await expect(
			call(d, { path: "domain.delete", input: { domainId: "d1" } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(d.ownerOf).toHaveBeenCalledWith("domain", "d1");

		const staging = deps({ ownerOf: vi.fn(async () => "app-staging") });
		const { next } = await call(staging, {
			path: "domain.delete",
			input: { domainId: "d2" },
		});
		expect(next).toHaveBeenCalled();
	});

	it("4. FR-005: a sub-resource without an owner is refused", async () => {
		const d = deps({ ownerOf: vi.fn(async () => null) });
		await expect(
			call(d, { path: "mounts.remove", input: { mountId: "m" } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("4. a query goes through", async () => {
		const { next } = await call(deps(), {
			path: "application.one",
			type: "query",
			input: { applicationId: "app-prod" },
		});
		expect(next).toHaveBeenCalled();
	});

	it("5. NFR-SEC-001: an error of the check is refused and recorded, never next()", async () => {
		const d = deps({
			getScope: vi.fn(async () => {
				throw new Error("db down");
			}),
		});
		const next = vi.fn();
		await expect(call(d, { next })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(next).not.toHaveBeenCalled();
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "error",
				reason: "read_only_check_failed",
			}),
		);
	});

	it("5. an error of the procedure itself is not swallowed", async () => {
		const failure = new Error("upstream failure");
		const next = vi.fn(async () => {
			throw failure;
		});
		await expect(
			call(deps(), { input: { applicationId: "app-staging" }, next }),
		).rejects.toBe(failure);
	});
});

describe("readOnlyGuard on queries (spec 006, FR-002, FR-006, research R6)", () => {
	// qa of quickstart: staging read-only.
	const QA = sets(
		["env-staging"],
		["app-staging", "pg-staging"],
		["project-1"],
	);
	const qa = () => deps({ getScope: vi.fn(async () => QA) });

	it.each([
		["application.one", { applicationId: "app-staging" }],
		["application.readLogs", { applicationId: "app-staging" }],
		["deployment.allByType", { id: "app-staging", type: "application" }],
		["application.readAppMonitoring", { appName: "app" }],
		["backup.one", { backupId: "b1" }],
	])("FR-002, US1-1: %s is never refused", async (path, input) => {
		const { next } = await call(qa(), { path, type: "query", input });
		expect(next).toHaveBeenCalled();
	});

	it("FR-006: masks the secrets of a read-only service in the response", async () => {
		const next = vi.fn(async () => ({
			ok: true,
			data: {
				applicationId: "app-staging",
				environmentId: "env-staging",
				env: "DB_PASSWORD=x",
				refreshToken: "t",
				name: "web",
			},
		}));
		const { result } = await call(qa(), {
			path: "application.one",
			type: "query",
			input: { applicationId: "app-staging" },
			next,
		});
		expect(result).toEqual({
			ok: true,
			data: {
				applicationId: "app-staging",
				environmentId: "env-staging",
				env: `DB_PASSWORD=${REDACTED_VALUE}`,
				refreshToken: REDACTED_VALUE,
				name: "web",
			},
		});
	});

	it("R6: a query that returns secrets as free text is refused on a read-only service", async () => {
		const d = deps();
		const next = vi.fn();
		await expect(
			call(d, {
				path: "compose.getConvertedCompose",
				type: "query",
				input: { composeId: "app-prod" },
				next,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(next).not.toHaveBeenCalled();
	});

	it("R6: the same query on a full-access service goes through", async () => {
		const { next } = await call(deps(), {
			path: "compose.getConvertedCompose",
			type: "query",
			input: { composeId: "c-staging" },
		});
		expect(next).toHaveBeenCalled();
	});

	it("masks the data an allowed mutation returns, and leaves failures as they are", async () => {
		const ok = vi.fn(async () => ({
			ok: true,
			data: { projectId: "project-1", env: "K=v" },
		}));
		const { result } = await call(deps(), {
			path: "environment.create",
			input: { projectId: "project-1", name: "dev" },
			next: ok,
		});
		expect(result).toEqual({
			ok: true,
			data: { projectId: "project-1", env: `K=${REDACTED_VALUE}` },
		});

		const failure = { ok: false, error: new Error("x") };
		const { result: failed } = await call(deps(), {
			input: { applicationId: "app-staging" },
			next: vi.fn(async () => failure),
		});
		expect(failed).toBe(failure);
	});

	it("does not touch a subscription's result", async () => {
		const stream = { ok: true, data: { subscribe: () => {} } };
		const { result } = await call(deps(), {
			path: "postgres.deployWithLogs",
			type: "subscription",
			input: { postgresId: "pg-staging" },
			next: vi.fn(async () => stream),
		});
		expect(result).toBe(stream);
	});

	it("members without read-only get the response untouched", async () => {
		const response = { ok: true, data: { env: "A=1", environmentId: "e" } };
		const { result } = await call(
			deps({ getScope: vi.fn(async () => sets()) }),
			{
				path: "application.one",
				type: "query",
				next: vi.fn(async () => response),
			},
		);
		expect(result).toBe(response);
	});
});

describe("developers see production without changing it (spec 006, US2, FR-003a, FR-007, SC-003)", () => {
	it.each([
		["application.deploy", { applicationId: "app-staging" }],
		["application.saveEnvironment", { applicationId: "app-staging" }],
		["environment.create", { projectId: "project-1", name: "dev" }],
	])("US2-3/SC-003: %s on staging goes through", async (path, input) => {
		const { next } = await call(deps(), { path, input });
		expect(next).toHaveBeenCalled();
	});

	it.each([
		["application.deploy", { applicationId: "app-prod" }],
		["application.saveEnvironment", { applicationId: "app-prod" }],
		["environment.duplicate", { environmentId: "env-prod", name: "copy" }],
		[
			"application.move",
			{
				applicationId: "app-staging",
				targetEnvironmentId: "env-prod",
			},
		],
	])("US2-2: %s on production is refused", async (path, input) => {
		await expect(call(deps(), { path, input })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it.each([
		["project.update", { projectId: "project-1", env: "K=v" }],
		["project.remove", { projectId: "project-1" }],
		["project.duplicate", { sourceEnvironmentId: "env-prod", name: "copy" }],
	])(
		"US2-4/FR-003a: %s on the project that holds production is refused",
		async (path, input) => {
			await expect(call(deps(), { path, input })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		},
	);
});

describe("readOnlyEvent (spec 006, FR-011)", () => {
	it("leaves the user and the resource out when there are none", () => {
		const event = readOnlyEvent(
			{
				user: null,
				path: "x.y",
				type: "mutation",
				getRawInput: async () => ({}),
			},
			"error",
		);
		expect(event).toMatchObject({
			type: "member_profile",
			outcome: "error",
			reason: "read_only_check_failed",
			action: "x.y",
		});
		expect(event).not.toHaveProperty("userId");
		expect(event).not.toHaveProperty("resourceId");
	});
});
