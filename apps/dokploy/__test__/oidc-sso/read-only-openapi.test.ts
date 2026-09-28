import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The config and event store of the module, without a database: no group
// profiles for the expiry guard, and denials collected in memory.
const recorded = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@dokploy/server/oidc-sso", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getOidcSsoServices: () => ({
		config: { getEffective: async () => ({ groupProfiles: null }) },
		events: {
			record: async (event: Record<string, unknown>) => {
				recorded.push(event);
			},
		},
	}),
}));

const { createOpenApiNextHandler } = await import("@dokploy/trpc-openapi");
const { appRouter } = await import("@/server/api/root");
const { memberProfileCache, readOnlyScopeCache } = await import(
	"@dokploy/server/oidc-sso/member-profile/cache"
);
const { READ_ONLY_DENIED_MESSAGE } = await import(
	"@dokploy/server/oidc-sso/types"
);

// What validateRequest builds for an x-api-key request: the key owner's user
// and member role (packages/server/src/lib/auth.ts).
const apiKeyContext = async () => ({
	user: { id: "qa-1", role: "member", ownerId: "owner" },
	session: { id: "api-key-session", activeOrganizationId: "org-1" },
	req: { headers: {} },
	res: {},
});

const request = async (
	method: "GET" | "POST",
	path: string,
	body?: unknown,
) => {
	const payload = body === undefined ? "" : JSON.stringify(body);
	const req = Object.assign(Readable.from(payload ? [payload] : []), {
		method,
		headers: {
			"content-type": "application/json",
			"content-length": String(Buffer.byteLength(payload)),
			"x-api-key": "test-key",
		},
		query: { trpc: path.split("?")[0] },
		url: `/api/${path}`,
	});
	let status = 0;
	let text = "";
	const res = {
		statusCode: 200,
		setHeader: () => {},
		getHeader: () => undefined,
		end(chunk?: string) {
			status = this.statusCode;
			text = chunk ?? "";
		},
		once: () => undefined,
	};
	await createOpenApiNextHandler({
		router: appRouter,
		createContext: apiKeyContext as never,
	})(req as never, res as never);
	return { status, body: text ? JSON.parse(text) : null };
};

beforeEach(() => {
	recorded.length = 0;
	memberProfileCache.reset();
	readOnlyScopeCache.reset();
	memberProfileCache.replace(["qa-1"], Date.now());
	readOnlyScopeCache.replace(
		[
			[
				"qa-1",
				{
					environmentIds: new Set(["env-staging"]),
					serviceIds: new Set(["app-staging", "compose-staging"]),
					projectIds: new Set(["project-1"]),
				},
			],
		],
		Date.now(),
	);
});

describe("read-only through the public API with an API key (spec 006, US3-1, FR-005, SC-002)", () => {
	it("refuses a deploy of a read-only service before the handler runs", async () => {
		const response = await request("POST", "application.deploy", {
			applicationId: "app-staging",
		});
		expect(response.status).toBe(403);
		expect(response.body).toMatchObject({ message: READ_ONLY_DENIED_MESSAGE });
		expect(recorded).toContainEqual(
			expect.objectContaining({
				reason: "read_only",
				userId: "qa-1",
				action: "application.deploy",
				resourceId: "app-staging",
			}),
		);
	});

	it("refuses a query that returns secrets as free text", async () => {
		const response = await request(
			"GET",
			"compose.getConvertedCompose?composeId=compose-staging",
		);
		expect(response.status).toBe(403);
		expect(response.body).toMatchObject({ message: READ_ONLY_DENIED_MESSAGE });
	});

	it("control: without a read-only scope the same call is not refused by the guard", async () => {
		readOnlyScopeCache.replace(
			[
				[
					"qa-1",
					{
						environmentIds: new Set(),
						serviceIds: new Set(),
						projectIds: new Set(),
					},
				],
			],
			Date.now(),
		);
		const response = await request("POST", "application.deploy", {
			applicationId: "app-staging",
		});
		expect(response.body?.message).not.toBe(READ_ONLY_DENIED_MESSAGE);
		expect(recorded).toEqual([]);
	});
});
