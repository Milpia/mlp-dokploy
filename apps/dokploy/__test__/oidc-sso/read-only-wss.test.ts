import type { ReadOnlySets } from "@dokploy/server/oidc-sso/member-profile/cache";
import {
	type ContainerBindingDeps,
	checkContainerBinding,
	checkDeploymentLogAccess,
	checkServerTerminal,
	type DeploymentLogDeps,
	type ServerTerminalDeps,
} from "@dokploy/server/oidc-sso/read-only/wss";
import { describe, expect, it, vi } from "vitest";

const sets = (serviceIds: string[] = []): ReadOnlySets => ({
	environmentIds: new Set(serviceIds.length ? ["env-prod"] : []),
	serviceIds: new Set(serviceIds),
	projectIds: new Set(serviceIds.length ? ["project-1"] : []),
});

const APP_NAMES: Record<string, string> = {
	"app-staging": "web-staging",
	"app-prod": "web-prod",
	"compose-staging": "stack-staging",
};

const LABELS: Record<string, Record<string, string>> = {
	"c-web-staging": { "com.docker.swarm.service.name": "web-staging" },
	"c-web-prod": { "com.docker.swarm.service.name": "web-prod" },
	"c-stack": {
		"com.docker.stack.namespace": "stack-staging",
		"com.docker.swarm.service.name": "stack-staging_db",
	},
	"c-compose": { "com.docker.compose.project": "stack-staging" },
};

const deps = (overrides: Partial<ContainerBindingDeps> = {}) => ({
	isProfiled: vi.fn(() => true),
	findRole: vi.fn(async () => "member" as string | null),
	getScope: vi.fn(async () => sets(["app-prod"])),
	appNameOf: vi.fn(async (id: string) => APP_NAMES[id] ?? null),
	labelsOf: vi.fn(async (containerId: string) => {
		const labels = LABELS[containerId];
		if (!labels) throw new Error("no such container");
		return labels;
	}),
	record: vi.fn(async () => {}),
	timeoutMs: 50,
	...overrides,
});

const check = (
	d: ReturnType<typeof deps>,
	{
		serviceId = "app-staging" as string | null,
		containerId = "c-web-staging",
		mode = "terminal" as "terminal" | "logs",
	} = {},
) =>
	checkContainerBinding(
		{
			userId: "dev-1",
			organizationId: "org-1",
			serviceId,
			containerId,
			serverId: null,
			mode,
		},
		d,
	);

describe("checkContainerBinding (spec 006, FR-004, FR-004b, FR-005, MIL-545)", () => {
	it("FR-009: a user without a profile passes with no role read nor inspection", async () => {
		const d = deps({ isProfiled: vi.fn(() => false) });
		await expect(check(d)).resolves.toEqual({ ok: true });
		expect(d.findRole).not.toHaveBeenCalled();
		expect(d.labelsOf).not.toHaveBeenCalled();
	});

	it("FR-009: an owner or admin passes even if still cached as profiled", async () => {
		const d = deps({ findRole: vi.fn(async () => "admin") });
		await expect(check(d, { containerId: "c-web-prod" })).resolves.toEqual({
			ok: true,
		});
		expect(d.labelsOf).not.toHaveBeenCalled();
	});

	it("allows the container of the service it was opened for", async () => {
		await expect(check(deps())).resolves.toEqual({ ok: true });
	});

	it("matches compose containers by stack namespace or compose project", async () => {
		for (const containerId of ["c-stack", "c-compose"]) {
			await expect(
				check(deps(), { serviceId: "compose-staging", containerId }),
			).resolves.toEqual({ ok: true });
		}
	});

	it("MIL-545: container of another service is refused", async () => {
		const d = deps();
		await expect(check(d, { containerId: "c-web-prod" })).resolves.toEqual({
			ok: false,
			reason: "container_mismatch",
		});
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "member_profile",
				outcome: "denied",
				reason: "container_mismatch",
				userId: "dev-1",
				action: "wss:docker-container-terminal",
				resourceId: "app-staging",
			}),
		);
	});

	it("MIL-545: applies to profiled members without read-only too", async () => {
		const d = deps({ getScope: vi.fn(async () => sets()) });
		await expect(
			check(d, { containerId: "c-web-prod", mode: "logs" }),
		).resolves.toMatchObject({ ok: false, reason: "container_mismatch" });
	});

	it("refuses a service that does not exist", async () => {
		await expect(
			check(deps(), { serviceId: "no-such-service" }),
		).resolves.toMatchObject({ ok: false, reason: "container_mismatch" });
	});

	it("refuses a connection without a service", async () => {
		await expect(check(deps(), { serviceId: null })).resolves.toMatchObject({
			ok: false,
			reason: "container_mismatch",
		});
	});

	it("FR-005: an inspection error or a timeout refuses", async () => {
		await expect(
			check(deps(), { containerId: "c-missing" }),
		).resolves.toMatchObject({ ok: false });
		const slow = deps({
			labelsOf: vi.fn(() => new Promise<Record<string, string>>(() => {})),
		});
		await expect(check(slow)).resolves.toMatchObject({ ok: false });
	});

	it("FR-004: the terminal of a read-only service is refused; its logs are allowed", async () => {
		const d = deps();
		await expect(
			check(d, { serviceId: "app-prod", containerId: "c-web-prod" }),
		).resolves.toEqual({ ok: false, reason: "read_only" });
		await expect(
			check(d, {
				serviceId: "app-prod",
				containerId: "c-web-prod",
				mode: "logs",
			}),
		).resolves.toEqual({ ok: true });
	});

	it("NFR-SEC-001: an error reading the scope refuses", async () => {
		const d = deps({
			getScope: vi.fn(async () => {
				throw new Error("db down");
			}),
		});
		await expect(check(d)).resolves.toMatchObject({ ok: false });
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "error",
				reason: "read_only_check_failed",
			}),
		);
	});
});

const LOGS: Record<string, string> = {
	"/etc/dokploy/logs/web-staging/a.log": "app-staging",
	"/etc/dokploy/logs/web-prod/b.log": "app-prod",
	"/etc/dokploy/logs/other/c.log": "app-other",
};

const logDeps = (overrides: Partial<DeploymentLogDeps> = {}) => ({
	isProfiled: vi.fn(() => true),
	findRole: vi.fn(async () => "member" as string | null),
	checkExpiry: vi.fn(async () => ({
		ok: true as const,
		outcome: "valid" as const,
	})),
	serviceOfLog: vi.fn(async (logPath: string) => LOGS[logPath] ?? null),
	accessedServices: vi.fn(async () => ["app-staging", "app-prod"]),
	record: vi.fn(async () => {}),
	...overrides,
});

const logCheck = (d: ReturnType<typeof logDeps>, logPath: string) =>
	checkDeploymentLogAccess(
		{ userId: "dev-1", organizationId: "org-1", logPath },
		d,
	);

describe("checkDeploymentLogAccess (spec 006, FR-004c, FR-008, MIL-546)", () => {
	it("FR-009: a user without a profile passes with no query", async () => {
		const d = logDeps({ isProfiled: vi.fn(() => false) });
		await expect(logCheck(d, "/etc/dokploy/logs/other/c.log")).resolves.toEqual(
			{
				ok: true,
			},
		);
		expect(d.findRole).not.toHaveBeenCalled();
		expect(d.serviceOfLog).not.toHaveBeenCalled();
	});

	it("FR-009: an owner or admin passes", async () => {
		const d = logDeps({ findRole: vi.fn(async () => "owner") });
		await expect(logCheck(d, "/etc/dokploy/logs/other/c.log")).resolves.toEqual(
			{
				ok: true,
			},
		);
		expect(d.serviceOfLog).not.toHaveBeenCalled();
	});

	it("FR-004: the log of a service in scope is readable, also when read-only", async () => {
		const d = logDeps();
		await expect(
			logCheck(d, "/etc/dokploy/logs/web-staging/a.log"),
		).resolves.toEqual({ ok: true });
		await expect(
			logCheck(d, "/etc/dokploy/logs/web-prod/b.log"),
		).resolves.toEqual({
			ok: true,
		});
	});

	it("MIL-546: deployment log outside the scope is refused", async () => {
		const d = logDeps();
		await expect(logCheck(d, "/etc/dokploy/logs/other/c.log")).resolves.toEqual(
			{
				ok: false,
				reason: "out_of_scope",
			},
		);
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "denied",
				reason: "out_of_scope",
				action: "wss:listen-deployment",
				resourceId: "app-other",
			}),
		);
	});

	it("refuses an unknown log path or a deployment without a service", async () => {
		await expect(
			logCheck(logDeps(), "/etc/dokploy/logs/server/x.log"),
		).resolves.toMatchObject({ ok: false, reason: "out_of_scope" });
	});

	it("MIL-546/FR-008: an expired profile is refused", async () => {
		const d = logDeps({
			checkExpiry: vi.fn(async () => ({
				ok: true as const,
				outcome: "expired" as const,
			})),
		});
		await expect(
			logCheck(d, "/etc/dokploy/logs/web-staging/a.log"),
		).resolves.toEqual({ ok: false, reason: "profile_expired" });
		expect(d.serviceOfLog).not.toHaveBeenCalled();
	});

	it("NFR-SEC-001: a failed expiry check or a read error refuses", async () => {
		await expect(
			logCheck(
				logDeps({ checkExpiry: vi.fn(async () => ({ ok: false as const })) }),
				"/etc/dokploy/logs/web-staging/a.log",
			),
		).resolves.toMatchObject({ ok: false });
		await expect(
			logCheck(
				logDeps({
					serviceOfLog: vi.fn(async () => {
						throw new Error("db down");
					}),
				}),
				"/etc/dokploy/logs/web-staging/a.log",
			),
		).resolves.toMatchObject({ ok: false, reason: "read_only_check_failed" });
	});
});

const terminalDeps = (overrides: Partial<ServerTerminalDeps> = {}) => ({
	isProfiled: vi.fn(() => true),
	findRole: vi.fn(async () => "member" as string | null),
	checkExpiry: vi.fn(async () => ({
		ok: true as const,
		outcome: "valid" as const,
	})),
	getScope: vi.fn(async () => sets(["app-prod"])),
	record: vi.fn(async () => {}),
	...overrides,
});

const terminal = (d: ReturnType<typeof terminalDeps>) =>
	checkServerTerminal({ userId: "dev-1", organizationId: "org-1" }, d);

describe("checkServerTerminal (spec 006, FR-004a, FR-008)", () => {
	it("FR-004a: refuses the server shell to a member with a read-only environment", async () => {
		const d = terminalDeps();
		await expect(terminal(d)).resolves.toEqual({
			ok: false,
			reason: "read_only",
		});
		expect(d.record).toHaveBeenCalledWith(
			expect.objectContaining({
				reason: "read_only",
				action: "wss:terminal",
			}),
		);
	});

	it("keeps upstream's decision for a member without read-only", async () => {
		await expect(
			terminal(terminalDeps({ getScope: vi.fn(async () => sets()) })),
		).resolves.toEqual({ ok: true });
	});

	it("FR-009: users without a profile, owners and admins keep upstream's decision", async () => {
		const unprofiled = terminalDeps({ isProfiled: vi.fn(() => false) });
		await expect(terminal(unprofiled)).resolves.toEqual({ ok: true });
		expect(unprofiled.getScope).not.toHaveBeenCalled();
		await expect(
			terminal(terminalDeps({ findRole: vi.fn(async () => "admin") })),
		).resolves.toEqual({ ok: true });
	});

	it("FR-008/NFR-SEC-001: a failed expiry check or scope read refuses", async () => {
		await expect(
			terminal(
				terminalDeps({
					checkExpiry: vi.fn(async () => ({ ok: false as const })),
				}),
			),
		).resolves.toMatchObject({ ok: false });
		await expect(
			terminal(
				terminalDeps({
					getScope: vi.fn(async () => {
						throw new Error("db down");
					}),
				}),
			),
		).resolves.toMatchObject({ ok: false, reason: "read_only_check_failed" });
	});
});
