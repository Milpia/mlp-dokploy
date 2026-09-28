import { beforeEach, describe, expect, it, vi } from "vitest";

const expiry = vi.hoisted(() => ({
	result: { ok: true, outcome: "skipped" } as
		| { ok: true; outcome: string }
		| { ok: false },
}));

vi.mock("@dokploy/server/services/permission", () => ({
	hasPermission: vi.fn(async () => true),
	findMemberByUserId: vi.fn(),
	checkServiceAccess: vi.fn(async () => {}),
}));
vi.mock("@dokploy/server", () => ({
	getAccessibleServerIds: vi.fn(async () => new Set()),
}));
vi.mock("@dokploy/server/oidc-sso", () => ({ getOidcSsoServices: vi.fn() }));
vi.mock("@dokploy/server/oidc-sso/member-profile/expiry", () => ({
	checkMemberProfileExpiryForUser: vi.fn(async () => expiry.result),
	defaultMemberProfileExpiryDeps: vi.fn(),
}));

const { canAccessDockerOverWss } = await import("@/server/wss/authorize");
const { checkServiceAccess } = await import(
	"@dokploy/server/services/permission"
);

const USER = { id: "dev-1" };
const SESSION = { activeOrganizationId: "org-1" };

beforeEach(() => {
	vi.clearAllMocks();
	expiry.result = { ok: true, outcome: "skipped" };
});

describe("WebSocket authorization with group profiles (spec 005, FR-017)", () => {
	it("still allows a member whose profile is valid", async () => {
		expiry.result = { ok: true, outcome: "valid" };
		await expect(
			canAccessDockerOverWss(USER, SESSION, null, "svc-1"),
		).resolves.toBe(true);
	});

	it("runs the expiry before the service check, so an expired scope is already cleared", async () => {
		expiry.result = { ok: true, outcome: "expired" };
		vi.mocked(checkServiceAccess).mockRejectedValueOnce(new Error("no access"));
		await expect(
			canAccessDockerOverWss(USER, SESSION, null, "svc-1"),
		).resolves.toBe(false);
	});

	it("NFR-SEC-001: denies when the expiry check fails", async () => {
		expiry.result = { ok: false };
		await expect(
			canAccessDockerOverWss(USER, SESSION, null, "svc-1"),
		).resolves.toBe(false);
		expect(checkServiceAccess).not.toHaveBeenCalled();
	});
});
