import { resolveRule } from "@dokploy/server/oidc-sso/read-only/policy";
import { describe, expect, it } from "vitest";
import { memberProfileGuard } from "@/server/api/middlewares/member-profile";
import { readOnlyGuard } from "@/server/api/middlewares/read-only";
import { appRouter } from "@/server/api/root";

type Procedures = Record<
	string,
	{ _def: { type: string; middlewares: unknown[] } }
>;

const procedures = (): Procedures =>
	(appRouter as unknown as { _def: { procedures: Procedures } })._def
		.procedures;

// A sync with upstream must not drop the guard nor add a mutation that
// nobody classified (spec 006, FR-005, research R5).
describe("readOnlyGuard in the procedure chains (spec 006, FR-005)", () => {
	it.each([
		["a protectedProcedure query", "oidcSso.memberProfileStatus"],
		["a withPermission procedure", "project.create"],
		["a service procedure", "application.deploy"],
	])("runs on %s (%s), after the expiry guard", (_label, path) => {
		const middlewares = procedures()[path]?._def.middlewares ?? [];
		const readOnly = middlewares.indexOf(readOnlyGuard);
		expect(readOnly).toBeGreaterThan(-1);
		expect(readOnly).toBeGreaterThan(middlewares.indexOf(memberProfileGuard));
	});
});

describe("READ_ONLY_POLICY covers appRouter (spec 006, FR-005, research R5)", () => {
	it("gives every mutation and subscription a rule", () => {
		const unclassified = Object.entries(procedures())
			.filter(([, p]) => p._def.type !== "query")
			.map(([path]) => path)
			.filter((path) => resolveRule(path) === undefined);
		expect(unclassified).toEqual([]);
	});
});

describe("secret columns are classified (spec 006, FR-006, research R6)", () => {
	it("every column that looks secret is masked, masked as .env or declared not secret", async () => {
		const schema = await import("@dokploy/server/db/schema");
		const { getTableColumns } = await import("drizzle-orm");
		const { ENV_FIELDS, NOT_SECRET_FIELDS, SECRET_FIELDS } = await import(
			"@dokploy/server/oidc-sso/read-only/secret-fields"
		);
		const tables = {
			applications: schema.applications,
			compose: schema.compose,
			postgres: schema.postgres,
			mysql: schema.mysql,
			mariadb: schema.mariadb,
			mongo: schema.mongo,
			redis: schema.redis,
			libsql: schema.libsql,
			projects: schema.projects,
			environments: schema.environments,
			mounts: schema.mounts,
			security: schema.security,
			backups: schema.backups,
		};
		const unclassified = Object.entries(tables).flatMap(([table, columns]) =>
			Object.keys(getTableColumns(columns))
				.filter((name) => /password|secret|token|env|key|content/i.test(name))
				.filter(
					(name) =>
						!SECRET_FIELDS.has(name) &&
						!ENV_FIELDS.has(name) &&
						!NOT_SECRET_FIELDS.has(name),
				)
				.map((name) => `${table}.${name}`),
		);
		expect(unclassified).toEqual([]);
	});
});
