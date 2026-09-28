import type { ReadOnlySets } from "@dokploy/server/oidc-sso/member-profile/cache";
import { redact } from "@dokploy/server/oidc-sso/read-only/redact";
import { REDACTED_VALUE } from "@dokploy/server/oidc-sso/types";
import { describe, expect, it } from "vitest";

const M = REDACTED_VALUE;

const scope: ReadOnlySets = {
	environmentIds: new Set(["env-prod"]),
	serviceIds: new Set(["app-prod", "pg-prod"]),
	projectIds: new Set(["project-1"]),
};

describe("redact (spec 006, FR-006, FR-006a, research R6)", () => {
	it("keeps only variable names, one per line, with masked values", () => {
		const app = {
			applicationId: "app-prod",
			environmentId: "env-prod",
			env: "# database\nDB_HOST=db\n\nexport TOKEN=abc=def\nFLAG",
			buildArgs: "NODE_ENV=production",
			buildSecrets: "NPM_TOKEN=x",
		};
		expect(redact(app, scope)).toEqual({
			...app,
			env: `DB_HOST=${M}\nTOKEN=${M}`,
			buildArgs: `NODE_ENV=${M}`,
			buildSecrets: `NPM_TOKEN=${M}`,
		});
	});

	it("security review: never returns a line of a multi-line value", () => {
		const env = [
			'PRIVATE_KEY="-----BEGIN PRIVATE KEY-----',
			"MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
			"bm90LWEtcmVhbC1rZXk=",
			'-----END PRIVATE KEY-----"',
			"SA_JSON='{",
			'  "private_key": "abc"',
			"}'",
			"DB_HOST=db",
		].join("\n");
		const result = redact({ environmentId: "env-prod", env }, scope) as {
			env: string;
		};
		expect(result.env).toBe(`PRIVATE_KEY=${M}\nSA_JSON=${M}\nDB_HOST=${M}`);
		expect(result.env).not.toMatch(/MIIE|bm90|private_key|BEGIN/);
	});

	it("masks passwords, tokens, mounted file content, compose content and commands", () => {
		const row = {
			postgresId: "pg-prod",
			environmentId: "env-prod",
			databasePassword: "p",
			databaseRootPassword: "r",
			refreshToken: "t",
			command: "run --secret",
			dockerImage: "postgres:16",
			externalPort: null,
		};
		expect(redact(row, scope)).toEqual({
			...row,
			databasePassword: M,
			databaseRootPassword: M,
			refreshToken: M,
			command: M,
		});
	});

	it("keeps the build type, branch, repository and the Dockerfile path visible", () => {
		const compose = {
			composeId: "c-prod",
			environmentId: "env-prod",
			composeFile: "services:\n  db:\n    environment:\n      PASSWORD: x",
			sourceType: "github",
			branch: "main",
			repository: "milpia",
		};
		expect(redact(compose, scope)).toEqual({ ...compose, composeFile: M });
		const app = {
			applicationId: "app-prod",
			environmentId: "env-prod",
			buildType: "dockerfile",
			dockerfile: "Dockerfile",
		};
		expect(redact(app, scope)).toEqual(app);
	});

	it("leaves null secrets as null", () => {
		const row = {
			environmentId: "env-prod",
			databasePassword: null,
			env: null,
		};
		expect(redact(row, scope)).toEqual(row);
	});

	it("does not touch objects of full-access environments", () => {
		const staging = {
			applicationId: "app-staging",
			environmentId: "env-staging",
			env: "A=1",
			refreshToken: "t",
		};
		expect(redact(staging, scope)).toEqual(staging);
	});

	it("decides by service id when an object has no environment id (security, mounts)", () => {
		expect(
			redact(
				[
					{ securityId: "s1", applicationId: "app-prod", password: "p" },
					{ securityId: "s2", applicationId: "app-staging", password: "p" },
					{
						mountId: "m1",
						postgresId: "pg-prod",
						type: "file",
						content: "secret=1",
						mountPath: "/etc/app.conf",
					},
				],
				scope,
			),
		).toEqual([
			{ securityId: "s1", applicationId: "app-prod", password: M },
			{ securityId: "s2", applicationId: "app-staging", password: "p" },
			{
				mountId: "m1",
				postgresId: "pg-prod",
				type: "file",
				content: M,
				mountPath: "/etc/app.conf",
			},
		]);
	});

	it("FR-006a: backup.one hides the embedded database password and keeps date, status and size", () => {
		const backup = {
			backupId: "b1",
			postgresId: "pg-prod",
			enabled: true,
			schedule: "0 0 * * *",
			postgres: {
				postgresId: "pg-prod",
				environmentId: "env-prod",
				databasePassword: "p",
			},
			deployments: [{ createdAt: "2026-09-28", status: "done", size: 42 }],
		};
		const result = redact(backup, scope) as typeof backup;
		expect(result.postgres.databasePassword).toBe(M);
		expect(result.deployments).toEqual(backup.deployments);
		expect(result.schedule).toBe("0 0 * * *");
	});

	it("FR-003a: a project row of a read-only project hides its shared variables", () => {
		expect(
			redact({ projectId: "project-1", name: "milpia", env: "K=v" }, scope),
		).toEqual({ projectId: "project-1", name: "milpia", env: `K=${M}` });
		expect(
			redact({ projectId: "project-2", name: "other", env: "K=v" }, scope),
		).toEqual({ projectId: "project-2", name: "other", env: "K=v" });
	});

	it("a child without identifying keys inherits; a child with its own keys decides", () => {
		const app = {
			applicationId: "app-prod",
			environmentId: "env-prod",
			registry: { registryId: "r1", password: "p" },
		};
		expect(redact(app, scope)).toMatchObject({ registry: { password: M } });

		const project = {
			projectId: "project-1",
			env: "SHARED=1",
			environments: [
				{ environmentId: "env-staging", env: "S=1", applications: [] },
				{ environmentId: "env-prod", env: "P=1" },
			],
		};
		expect(redact(project, scope)).toEqual({
			projectId: "project-1",
			env: `SHARED=${M}`,
			environments: [
				{ environmentId: "env-staging", env: "S=1", applications: [] },
				{ environmentId: "env-prod", env: `P=${M}` },
			],
		});
	});

	it("does not mutate the input and keeps dates and primitives", () => {
		const createdAt = new Date("2026-09-28T00:00:00Z");
		const app = { environmentId: "env-prod", env: "A=1", createdAt };
		const copy = structuredClone(app);
		const result = redact(app, scope) as typeof app;
		expect(app).toEqual(copy);
		expect(result.createdAt).toBe(createdAt);
		expect(redact("text", scope)).toBe("text");
		expect(redact(null, scope)).toBeNull();
	});
});

describe("redact of a developer's project (spec 006, US2-1, FR-006, FR-007)", () => {
	it("shows staging values and masks production and the shared project variables", () => {
		const projectOne = {
			projectId: "project-1",
			name: "milpia",
			env: "SHARED=1",
			environments: [
				{
					environmentId: "env-staging",
					name: "staging",
					env: "S=1",
					applications: [
						{
							applicationId: "app-staging",
							environmentId: "env-staging",
							env: "A=1",
							refreshToken: "staging-token",
						},
					],
				},
				{
					environmentId: "env-prod",
					name: "production",
					env: "P=1",
					applications: [
						{
							applicationId: "app-prod",
							environmentId: "env-prod",
							env: "A=2",
							refreshToken: "prod-token",
						},
					],
				},
			],
		};
		expect(redact(projectOne, scope)).toEqual({
			...projectOne,
			env: `SHARED=${M}`,
			environments: [
				projectOne.environments[0],
				{
					environmentId: "env-prod",
					name: "production",
					env: `P=${M}`,
					applications: [
						{
							applicationId: "app-prod",
							environmentId: "env-prod",
							env: `A=${M}`,
							refreshToken: M,
						},
					],
				},
			],
		});
	});
});
