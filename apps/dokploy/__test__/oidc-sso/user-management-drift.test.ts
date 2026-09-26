import { TRPC_USER_MANAGEMENT_PATHS } from "@dokploy/server/oidc-sso/user-management/paths";
import { describe, expect, it } from "vitest";
import { userManagementGuard } from "@/server/api/middlewares/user-management";
import { appRouter } from "@/server/api/root";

// Mutations whose path looks like user management but that only act on the
// caller's own account or organizations. Reviewed by hand (spec 002,
// research R2): a new upstream mutation matching the pattern must be
// classified here or in TRPC_USER_MANAGEMENT_PATHS before this test passes.
const REVIEWED_NOT_USER_MANAGEMENT = new Set<string>([
	"user.update", // always the caller's own profile
	"user.revokeSession", // upstream already limits other users' sessions to the owner
	"user.generateToken", // no-op
	"user.createApiKey", // the caller's own key
	"user.deleteApiKey", // checks the key belongs to the caller
	"user.toggleTemplateBookmark", // the caller's own bookmarks
	"organization.create", // a new organization owned by the caller
	"organization.update", // owner-only upstream
	"organization.delete", // owner-only upstream
	"organization.setDefault", // the caller's own default organization
]);

const SUSPICIOUS = /(user|member|invit|role|permission|organization)/i;

type Procedures = Record<
	string,
	{ _def: { type: string; middlewares: unknown[] } }
>;

const procedures = (): Procedures =>
	(appRouter as unknown as { _def: { procedures: Procedures } })._def
		.procedures;

const procedurePaths = (): string[] => Object.keys(procedures());

describe("user-management path list vs appRouter (spec 002, FR-004)", () => {
	it("every protected path still exists in the router", () => {
		const paths = new Set(procedurePaths());
		const missing = [...TRPC_USER_MANAGEMENT_PATHS.keys()].filter(
			(path) => !paths.has(path),
		);
		expect(missing).toEqual([]);
	});

	// A listed path served by a builder that skips protectedProcedure (e.g.
	// enterpriseProcedure) would never reach the guard (security review, T029).
	it("every protected path actually runs the guard", () => {
		const all = procedures();
		const unguarded = [...TRPC_USER_MANAGEMENT_PATHS.keys()].filter(
			(path) => !all[path]?._def.middlewares.includes(userManagementGuard),
		);
		expect(unguarded).toEqual([]);
	});

	it("every mutation that looks like user management is classified", () => {
		const all = procedures();
		const unclassified = procedurePaths().filter(
			(path) =>
				all[path]?._def.type === "mutation" &&
				SUSPICIOUS.test(path) &&
				!TRPC_USER_MANAGEMENT_PATHS.has(path) &&
				!REVIEWED_NOT_USER_MANAGEMENT.has(path),
		);
		expect(unclassified).toEqual([]);
	});
});
