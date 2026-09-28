import {
	GROUP_PROFILES_MAX_BYTES,
	mergeProfiles,
	parseGroupProfiles,
} from "@dokploy/server/oidc-sso/domain/group-profiles";
import { describe, expect, it } from "vitest";

const developers = {
	permissions: [],
	projects: ["alpha", "beta"],
	environments: { exclude: ["production"] },
};

const parse = (value: unknown) =>
	parseGroupProfiles(typeof value === "string" ? value : JSON.stringify(value));

const errorOf = (value: unknown) => {
	const result = parse(value);
	if (result.ok) throw new Error("expected a validation error");
	return result.error;
};

describe("parseGroupProfiles (spec 005, FR-008, FR-009, R10)", () => {
	it.each([null, "", "   "])("treats %j as disabled", (value) => {
		expect(parseGroupProfiles(value)).toEqual({ ok: true, profiles: [] });
	});

	it("accepts the Milpia configuration", () => {
		expect(parse({ developers })).toEqual({
			ok: true,
			profiles: [{ group: "developers", ...developers }],
		});
	});

	it("keeps granted permissions and an include filter", () => {
		expect(
			parse({
				qa: {
					permissions: ["canAccessToDocker"],
					projects: [],
					environments: { include: ["staging"] },
				},
			}),
		).toMatchObject({
			ok: true,
			profiles: [
				{
					group: "qa",
					permissions: ["canAccessToDocker"],
					environments: { include: ["staging"] },
				},
			],
		});
	});

	it("rejects invalid JSON", () => {
		expect(errorOf("{developers:")).toMatch(/not valid JSON/);
	});

	it("rejects a value over the size limit", () => {
		const projects = Array.from({ length: 2000 }, (_, i) => `project-${i}`);
		expect(
			JSON.stringify({ developers: { permissions: [], projects } }).length,
		).toBeGreaterThan(GROUP_PROFILES_MAX_BYTES);
		expect(errorOf({ developers: { permissions: [], projects } })).toMatch(
			/16384 bytes/,
		);
	});

	it("rejects an unknown permission with its path", () => {
		expect(
			errorOf({ developers: { permissions: ["canDeploy"], projects: [] } }),
		).toBe('developers.permissions[0]: unknown permission "canDeploy"');
	});

	it.each([
		["an empty group name", { "": { permissions: [], projects: [] } }],
		["a blank group name", { "  ": { permissions: [], projects: [] } }],
		[
			"a group name over 256 characters",
			{ ["g".repeat(257)]: { permissions: [], projects: [] } },
		],
		["a group name with a comma", { "a,b": { permissions: [], projects: [] } }],
	])("rejects %s", (_label, value) => {
		expect(errorOf(value)).toMatch(/group name/);
	});

	it("rejects more than 20 groups", () => {
		const value = Object.fromEntries(
			Array.from({ length: 21 }, (_, i) => [
				`g${i}`,
				{ permissions: [], projects: [] },
			]),
		);
		expect(errorOf(value)).toMatch(/at most 20 groups/);
	});

	it("rejects more than 200 projects in a group", () => {
		const projects = Array.from({ length: 201 }, (_, i) => `p${i}`);
		expect(errorOf({ developers: { permissions: [], projects } })).toMatch(
			/developers\.projects/,
		);
	});

	it("rejects more than 20 environments in a list", () => {
		const exclude = Array.from({ length: 21 }, (_, i) => `e${i}`);
		expect(
			errorOf({
				developers: {
					permissions: [],
					projects: [],
					environments: { exclude },
				},
			}),
		).toMatch(/developers\.environments/);
	});

	it("rejects include and exclude together", () => {
		expect(
			errorOf({
				developers: {
					permissions: [],
					projects: [],
					environments: { include: ["staging"], exclude: ["production"] },
				},
			}),
		).toMatch(/developers\.environments/);
	});

	it.each([
		["permissions", { projects: [] }],
		["projects", { permissions: [] }],
	])("rejects a profile without %s", (field, profile) => {
		expect(errorOf({ developers: profile })).toMatch(
			new RegExp(`developers\\.${field}`),
		);
	});

	it("rejects unknown keys so a typo does not silently widen access", () => {
		expect(
			errorOf({
				developers: { permissions: [], projects: [], project: ["x"] },
			}),
		).toMatch(/developers/);
	});

	it("rejects a top level that is not an object", () => {
		expect(errorOf(["developers"])).toMatch(/object/);
	});
});

describe("mergeProfiles (spec 005, FR-006)", () => {
	const profiles = [
		{
			group: "developers",
			permissions: ["canCreateServices" as const],
			projects: ["alpha"],
			environments: { exclude: ["production"] },
		},
		{
			group: "qa",
			permissions: ["canAccessToDocker" as const, "canCreateServices" as const],
			projects: ["beta"],
		},
	];

	it("returns null when the user is in no profiled group", () => {
		expect(mergeProfiles(profiles, ["leads"])).toBeNull();
		expect(mergeProfiles([], ["developers"])).toBeNull();
	});

	it("unions permissions and keeps each group's scope", () => {
		expect(mergeProfiles(profiles, ["developers", "qa"])).toEqual({
			groups: ["developers", "qa"],
			permissions: ["canCreateServices", "canAccessToDocker"],
			scopes: [
				{ projects: ["alpha"], environments: { exclude: ["production"] } },
				{ projects: ["beta"] },
			],
		});
	});

	it("matches groups the same way as the access and admin groups", () => {
		expect(mergeProfiles(profiles, ["/teams/developers"])?.groups).toEqual([
			"developers",
		]);
	});
});

describe("readOnly in parseGroupProfiles (spec 006, FR-001, FR-014)", () => {
	const qa = {
		permissions: [],
		projects: ["milpia"],
		environments: { exclude: ["production"] },
	};

	it.each([
		[undefined, undefined],
		[false, undefined],
		[true, true],
	])("accepts readOnly %j", (readOnly, expected) => {
		const result = parse({ qa: { ...qa, readOnly } });
		expect(result).toMatchObject({ ok: true });
		if (result.ok) expect(result.profiles[0]?.readOnly).toEqual(expected);
	});

	it("accepts a list of environment names inside the group scope", () => {
		expect(
			parse({
				developers: {
					permissions: [],
					projects: ["milpia"],
					readOnly: [" production "],
				},
			}),
		).toMatchObject({ ok: true, profiles: [{ readOnly: ["production"] }] });
	});

	it.each(["yes", {}, [], 1])("rejects readOnly %j", (readOnly) => {
		expect(errorOf({ qa: { ...qa, readOnly } })).toBe(
			"qa.readOnly: must be true, false or a list of environment names",
		);
	});

	it("rejects an empty name and a name over 256 characters", () => {
		expect(errorOf({ qa: { ...qa, readOnly: [" "] } })).toBe(
			"qa.readOnly[0]: must be a non-empty name",
		);
		expect(errorOf({ qa: { ...qa, readOnly: ["x".repeat(257)] } })).toBe(
			"qa.readOnly[0]: at most 256 characters",
		);
	});

	it("rejects more than 20 names", () => {
		const names = Array.from({ length: 21 }, (_, i) => `env-${i}`);
		expect(errorOf({ qa: { ...qa, readOnly: names } })).toBe(
			"qa.readOnly: at most 20 names",
		);
	});

	it("rejects a duplicate name", () => {
		expect(
			errorOf({ qa: { ...qa, readOnly: ["staging", "dev", "staging"] } }),
		).toBe('qa.readOnly[2]: duplicate environment "staging"');
	});

	it("rejects a name excluded from the group scope", () => {
		expect(
			errorOf({
				developers: {
					permissions: [],
					projects: ["milpia"],
					environments: { exclude: ["production"] },
					readOnly: ["production"],
				},
			}),
		).toBe(
			'developers.readOnly[0]: environment "production" is excluded from the group scope',
		);
	});

	it("rejects a name missing from the group include list", () => {
		expect(
			errorOf({
				developers: {
					permissions: [],
					projects: ["milpia"],
					environments: { include: ["staging", "production"] },
					readOnly: ["production", "stage"],
				},
			}),
		).toBe(
			'developers.readOnly[1]: environment "stage" is not in the group include list',
		);
	});

	it("rejects the whole set when one group fails", () => {
		const result = parse({
			developers: { permissions: [], projects: ["milpia"] },
			qa: { ...qa, readOnly: "yes" },
		});
		expect(result.ok).toBe(false);
	});
});

describe("readOnly in mergeProfiles (spec 006, FR-007)", () => {
	it("keeps readOnly per scope part", () => {
		expect(
			mergeProfiles(
				[
					{
						group: "developers",
						permissions: [],
						projects: ["milpia"],
						readOnly: ["production"],
					},
					{
						group: "qa",
						permissions: [],
						projects: ["milpia"],
						readOnly: true,
					},
				],
				["developers", "qa"],
			)?.scopes,
		).toEqual([
			{ projects: ["milpia"], readOnly: ["production"] },
			{ projects: ["milpia"], readOnly: true },
		]);
	});
});
