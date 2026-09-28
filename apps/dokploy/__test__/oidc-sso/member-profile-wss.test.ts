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
// The container binding of spec 006 is tested in __test__/oidc-sso.
vi.mock("@dokploy/server/oidc-sso/read-only/wss", () => ({
	checkContainerBinding: vi.fn(async () => ({ ok: true })),
	defaultContainerBindingDeps: vi.fn(),
	checkDeploymentLogAccess: vi.fn(async () => ({ ok: true })),
	defaultDeploymentLogDeps: vi.fn(),
	checkServerTerminal: vi.fn(async () => ({ ok: true })),
	defaultServerTerminalDeps: vi.fn(),
}));
vi.mock("@dokploy/server/oidc-sso/member-profile/expiry", () => ({
	checkMemberProfileExpiryForUser: vi.fn(async () => expiry.result),
	defaultMemberProfileExpiryDeps: vi.fn(),
}));

const { canAccessDockerOverWss, canAccessTerminalOverWss } = await import(
	"@/server/wss/authorize"
);
const { checkServerTerminal } = await import(
	"@dokploy/server/oidc-sso/read-only/wss"
);
const { findMemberByUserId } = await import(
	"@dokploy/server/services/permission"
);
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

describe("server terminal with read-only environments (spec 006, FR-004a)", () => {
	it("refuses the terminal when the read-only check refuses, before upstream decides", async () => {
		vi.mocked(findMemberByUserId).mockResolvedValue({ role: "owner" } as never);
		vi.mocked(checkServerTerminal).mockResolvedValueOnce({
			ok: false,
			reason: "read_only",
		});
		await expect(
			canAccessTerminalOverWss(USER, SESSION, "local"),
		).resolves.toBe(false);
		await expect(
			canAccessTerminalOverWss(USER, SESSION, "local"),
		).resolves.toBe(true);
	});
});
