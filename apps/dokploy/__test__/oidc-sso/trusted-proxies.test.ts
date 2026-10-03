import {
	readTrustedProxies,
	trustedProxiesAdvanced,
} from "@dokploy/server/oidc-sso/config/trusted-proxies";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint, getIp } from "better-auth/api";
import { describe, expect, it } from "vitest";

const EDGE = "172.31.99.10";
const TRUSTED = { SSO_OIDC_TRUSTED_PROXIES: "172.31.99.0/24, 2400:cb00::/32" };

const request = (forwardedFor?: string) =>
	new Request("http://dokploy.test/api/auth/oidc/ping", {
		headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
	});

const resolveIp = (forwardedFor: string, env: Record<string, string>) =>
	getIp(request(forwardedFor), {
		advanced: trustedProxiesAdvanced(env),
	} as never);

// The same kind of rule the SSO plugin sets on /oidc/*, with a smaller max.
const authWithLimit = (env: Record<string, string>) =>
	betterAuth({
		secret: "test-secret-test-secret-test-secret",
		baseURL: "http://dokploy.test",
		database: memoryAdapter({}),
		rateLimit: { enabled: true, window: 60, max: 100 },
		advanced: trustedProxiesAdvanced(env),
		plugins: [
			{
				id: "trusted-proxies-test",
				endpoints: {
					ping: createAuthEndpoint(
						"/oidc/ping",
						{ method: "GET" },
						async (ctx) => ctx.json({ ok: true }),
					),
				},
				rateLimit: [
					{
						pathMatcher: (path: string) => path.startsWith("/oidc/"),
						window: 60,
						max: 2,
					},
				],
			},
		],
	});

const statuses = async (
	auth: ReturnType<typeof authWithLimit>,
	forwardedFor: string,
	times: number,
) => {
	const result: number[] = [];
	for (let i = 0; i < times; i++) {
		result.push((await auth.handler(request(forwardedFor))).status);
	}
	return result;
};

describe("SSO_OIDC_TRUSTED_PROXIES", () => {
	it("reads a comma-separated list and ignores blanks", () => {
		expect(readTrustedProxies({})).toEqual([]);
		expect(readTrustedProxies({ SSO_OIDC_TRUSTED_PROXIES: " , " })).toEqual([]);
		expect(readTrustedProxies(TRUSTED)).toEqual([
			"172.31.99.0/24",
			"2400:cb00::/32",
		]);
	});

	it("without the variable, nothing is added to better-auth", () => {
		expect(trustedProxiesAdvanced({})).toEqual({});
	});

	it("resolves the client behind a trusted proxy", () => {
		expect(resolveIp(`203.0.113.7, ${EDGE}`, TRUSTED)).toBe("203.0.113.7");
	});

	// Unresolved, better-auth uses one shared key: null in production and
	// 127.0.0.1 under test.
	it("without the variable, an extended header does not resolve to the client", () => {
		expect(resolveIp(`203.0.113.7, ${EDGE}`, {})).not.toBe("203.0.113.7");
		expect(resolveIp("203.0.113.7", {})).toBe("203.0.113.7");
	});

	it("a client cannot pick its address through an untrusted last hop", () => {
		expect(resolveIp("198.51.100.1, 203.0.113.7", TRUSTED)).toBe("203.0.113.7");
	});

	describe("the /oidc/* rate limit", () => {
		it("counts each client separately behind a trusted proxy", async () => {
			const auth = authWithLimit(TRUSTED);
			expect(await statuses(auth, `203.0.113.7, ${EDGE}`, 3)).toEqual([
				200, 200, 429,
			]);
			expect(await statuses(auth, `203.0.113.8, ${EDGE}`, 1)).toEqual([200]);
		});

		it("without the variable, every client behind the proxy shares one bucket", async () => {
			const auth = authWithLimit({});
			expect(await statuses(auth, `203.0.113.7, ${EDGE}`, 2)).toEqual([
				200, 200,
			]);
			expect(await statuses(auth, `203.0.113.8, ${EDGE}`, 1)).toEqual([429]);
		});
	});
});
