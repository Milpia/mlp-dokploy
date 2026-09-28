import { describe, expect, it } from "vitest";
import { memberProfileGuard } from "@/server/api/middlewares/member-profile";
import { appRouter } from "@/server/api/root";

type Procedures = Record<string, { _def: { middlewares: unknown[] } }>;

const procedures = (): Procedures =>
	(appRouter as unknown as { _def: { procedures: Procedures } })._def
		.procedures;

// The expiry must run on every request a member can make (spec 005,
// FR-017, research R6); a sync with upstream must not drop it silently.
describe("memberProfileGuard in the procedure chains (spec 005)", () => {
	it.each([
		["a protectedProcedure query", "oidcSso.memberProfileStatus"],
		["a withPermission procedure", "project.create"],
		["a service procedure", "application.deploy"],
	])("runs on %s (%s)", (_label, path) => {
		const procedure = procedures()[path];
		expect(procedure).toBeDefined();
		expect(procedure?._def.middlewares).toContain(memberProfileGuard);
	});
});
