import type { ReadOnlySets } from "@dokploy/server/oidc-sso/member-profile/cache";
import {
	evaluate,
	READ_ONLY_POLICY,
	resolveRule,
} from "@dokploy/server/oidc-sso/read-only/policy";
import { describe, expect, it } from "vitest";

const scope: ReadOnlySets = {
	environmentIds: new Set(["env-prod"]),
	serviceIds: new Set(["app-prod", "pg-prod"]),
	projectIds: new Set(["project-1"]),
};

const allow = { allow: true };
const deny = (resourceId?: string) => ({ allow: false, resourceId });

describe("evaluate (spec 006, FR-003, FR-003a, FR-004a, FR-005, research R5)", () => {
	describe("service", () => {
		const rule = { kind: "service", keys: ["applicationId"] } as const;

		it("denies a read-only service", () => {
			expect(evaluate(rule, { applicationId: "app-prod" }, scope)).toEqual(
				deny("app-prod"),
			);
		});

		it("allows a service with full access", () => {
			expect(evaluate(rule, { applicationId: "app-staging" }, scope)).toEqual(
				allow,
			);
		});

		it("FR-005: denies when the id is missing", () => {
			expect(evaluate(rule, {}, scope)).toEqual(deny());
			expect(evaluate(rule, undefined, scope)).toEqual(deny());
			expect(evaluate(rule, { applicationId: 7 }, scope)).toEqual(deny());
		});

		it("uses the first key present", () => {
			const backup = {
				kind: "service",
				keys: ["postgresId", "mysqlId", "composeId"],
			} as const;
			expect(evaluate(backup, { mysqlId: "my-staging" }, scope)).toEqual(allow);
			expect(evaluate(backup, { postgresId: "pg-prod" }, scope)).toEqual(
				deny("pg-prod"),
			);
			expect(evaluate(backup, { destinationId: "d" }, scope)).toEqual(deny());
		});

		it("reads multipart form data, like application.dropDeployment", () => {
			const form = new FormData();
			form.set("applicationId", "app-prod");
			expect(evaluate(rule, form, scope)).toEqual(deny("app-prod"));
			form.set("applicationId", "app-staging");
			expect(evaluate(rule, form, scope)).toEqual(allow);
		});
	});

	describe("environment", () => {
		const rule = { kind: "environment", key: "environmentId" } as const;

		it("denies creating in a read-only environment and allows elsewhere", () => {
			expect(evaluate(rule, { environmentId: "env-prod" }, scope)).toEqual(
				deny("env-prod"),
			);
			expect(evaluate(rule, { environmentId: "env-staging" }, scope)).toEqual(
				allow,
			);
			expect(evaluate(rule, {}, scope)).toEqual(deny());
		});
	});

	describe("project (FR-003a)", () => {
		const rule = { kind: "project", key: "projectId" } as const;

		it("denies a project that holds a read-only environment", () => {
			expect(evaluate(rule, { projectId: "project-1" }, scope)).toEqual(
				deny("project-1"),
			);
			expect(evaluate(rule, { projectId: "project-2" }, scope)).toEqual(allow);
			expect(evaluate(rule, {}, scope)).toEqual(deny());
		});
	});

	describe("lookup", () => {
		const rule = {
			kind: "lookup",
			resource: "domain",
			key: "domainId",
		} as const;

		it("asks for the owner of the sub-resource", () => {
			expect(evaluate(rule, { domainId: "d1" }, scope)).toEqual({
				lookup: "domain",
				id: "d1",
			});
		});

		it("FR-005: denies when the id is missing", () => {
			expect(evaluate(rule, {}, scope)).toEqual(deny());
		});
	});

	describe("unbound, outside and secretQuery", () => {
		it("FR-004a: unbound always denies a user with a read-only scope", () => {
			expect(
				evaluate({ kind: "unbound" }, { containerId: "c" }, scope),
			).toEqual(deny());
		});

		it("outside allows", () => {
			expect(evaluate({ kind: "outside" }, { name: "x" }, scope)).toEqual(
				allow,
			);
		});

		it("secretQuery denies a read-only target and allows others", () => {
			const rule = { kind: "secretQuery", keys: ["composeId"] } as const;
			expect(evaluate(rule, { composeId: "app-prod" }, scope)).toEqual(
				deny("app-prod"),
			);
			expect(evaluate(rule, { composeId: "c-staging" }, scope)).toEqual(allow);
		});
	});

	describe("any read-only id in the input denies, whatever the rule", () => {
		it("a move into a read-only environment", () => {
			expect(
				evaluate(
					{ kind: "service", keys: ["applicationId"] },
					{ applicationId: "app-staging", targetEnvironmentId: "env-prod" },
					scope,
				),
			).toEqual(deny("env-prod"));
		});

		it("an update that points a sub-resource at a read-only service", () => {
			expect(
				evaluate(
					{ kind: "lookup", resource: "mount", key: "mountId" },
					{ mountId: "m1", postgresId: "pg-prod" },
					scope,
				),
			).toEqual(deny("pg-prod"));
		});

		it("security review: a nested service id, like project.duplicate selectedServices", () => {
			expect(
				evaluate(
					{ kind: "environment", key: "sourceEnvironmentId" },
					{
						sourceEnvironmentId: "env-staging",
						selectedServices: [
							{ id: "app-staging", type: "application" },
							{ id: "pg-prod", type: "postgres" },
						],
					},
					scope,
				),
			).toEqual(deny("pg-prod"));
		});

		it("a list without read-only ids goes through", () => {
			expect(
				evaluate(
					{ kind: "environment", key: "sourceEnvironmentId" },
					{
						sourceEnvironmentId: "env-staging",
						selectedServices: [{ id: "app-staging", type: "application" }],
					},
					scope,
				),
			).toEqual(allow);
		});

		it("security review: nested objects are walked too", () => {
			expect(
				evaluate(
					{ kind: "outside" },
					{ data: { nested: { applicationId: "app-prod" } } },
					scope,
				),
			).toEqual(deny("app-prod"));
		});

		it("an outside rule with a read-only environment id", () => {
			expect(
				evaluate({ kind: "outside" }, { environmentId: "env-prod" }, scope),
			).toEqual(deny("env-prod"));
		});
	});
});

describe("resolveRule (spec 006, research R5)", () => {
	it("prefers the exact path over the router default", () => {
		expect(resolveRule("application.create")).toEqual({
			kind: "environment",
			key: "environmentId",
		});
		expect(resolveRule("application.deploy")).toEqual({
			kind: "service",
			keys: ["applicationId"],
		});
	});

	it("returns undefined for an unknown path, so the guard denies", () => {
		expect(resolveRule("brandNew.mutation")).toBeUndefined();
		expect(resolveRule("nodots")).toBeUndefined();
	});

	it("FR-003a: project changes and duplicates are bound to the read-only scope", () => {
		expect(resolveRule("project.update")).toEqual({
			kind: "project",
			key: "projectId",
		});
		expect(resolveRule("project.duplicate")).toEqual({
			kind: "environment",
			key: "sourceEnvironmentId",
		});
	});

	it("FR-004a: server-level Docker actions and volume restores are unbound", () => {
		for (const path of [
			"docker.restartContainer",
			"dockerVolume.removeVolume",
			"volumeBackups.restoreVolumeBackupWithLogs",
			"backup.manualBackupWebServer",
		]) {
			expect(resolveRule(path)).toEqual({ kind: "unbound" });
		}
	});

	it("keeps the registry keyed by exact paths or router defaults only", () => {
		for (const key of Object.keys(READ_ONLY_POLICY)) {
			expect(key).toMatch(/^[A-Za-z]+\.(\*|[A-Za-z]+)$/);
		}
	});
});
