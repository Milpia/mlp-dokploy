import { DEFAULT_STORED_CONFIG } from "@dokploy/server/keycloak-sso/config/repository";
import { keycloakSso } from "@dokploy/server/keycloak-sso/plugin/index";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { makeDeps } from "./helpers";

const BASE = "http://localhost:3000";
const SECRET = "test-secret-that-is-long-enough-for-better-auth";

const p95 = (samples: number[]) => {
	const sorted = [...samples].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
	);
};

const measure = async (runs: number, fn: () => Promise<unknown>) => {
	for (let i = 0; i < 20; i++) await fn();
	const samples: number[] = [];
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		await fn();
		samples.push(performance.now() - start);
	}
	return samples;
};

const memory = () => ({
	user: [
		{
			id: "new-user-id",
			email: "dev@example.com",
			name: "Dev",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	] as Record<string, unknown>[],
	session: [] as Record<string, unknown>[],
	account: [] as Record<string, unknown>[],
	verification: [] as Record<string, unknown>[],
});

describe("performance (NFR-PERF, SC-008, SC-009)", () => {
	it("NFR-PERF-001/SC-009: with the feature disabled, the plugin adds under 5 ms p95 and no Keycloak call", async () => {
		const built = makeDeps({ config: DEFAULT_STORED_CONFIG });
		const withPlugin = betterAuth({
			baseURL: BASE,
			secret: SECRET,
			database: memoryAdapter(memory()),
			rateLimit: { enabled: false },
			logger: { disabled: true },
			emailAndPassword: { enabled: true },
			plugins: [keycloakSso({ resolveDeps: () => built.deps })],
		});
		const withoutPlugin = betterAuth({
			baseURL: BASE,
			secret: SECRET,
			database: memoryAdapter(memory()),
			rateLimit: { enabled: false },
			logger: { disabled: true },
			emailAndPassword: { enabled: true },
		});
		// A guarded route, so the SSO-only hook runs, that answers without the
		// cost of password hashing (which would dominate the measurement).
		const request = () =>
			new Request(`${BASE}/api/auth/sign-in/social`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: BASE },
				body: JSON.stringify({ provider: "github" }),
			});

		const baseline = p95(
			await measure(200, () => withoutPlugin.handler(request())),
		);
		const current = p95(
			await measure(200, () => withPlugin.handler(request())),
		);

		console.info(
			`[perf] guarded auth request p95: without plugin ${baseline.toFixed(2)} ms, with plugin (disabled) ${current.toFixed(2)} ms`,
		);
		expect(current - baseline).toBeLessThan(5);
		expect(built.oidc.createAuthorizationRequest).not.toHaveBeenCalled();
		expect(built.oidc.exchangeCode).not.toHaveBeenCalled();
		// Config reads are served from the cache, not the repository.
		expect(built.repository.get).toHaveBeenCalledTimes(1);
	}, 60_000);

	it("NFR-PERF-002/006, SC-008: 50 concurrent callbacks each take under 300 ms of Dokploy work", async () => {
		const built = makeDeps();
		const auth = betterAuth({
			baseURL: BASE,
			secret: SECRET,
			database: memoryAdapter(memory()),
			rateLimit: { enabled: false },
			logger: { disabled: true },
			plugins: [keycloakSso({ resolveDeps: () => built.deps })],
		});

		const start = await auth.handler(
			new Request(`${BASE}/api/auth/keycloak/sign-in`),
		);
		const cookie = start.headers
			.getSetCookie()
			.map((c) => c.split(";")[0] ?? "")
			.join("; ");

		const durations: number[] = [];
		const responses = await Promise.all(
			Array.from({ length: 50 }, async () => {
				const t0 = performance.now();
				const response = await auth.handler(
					new Request(`${BASE}/api/auth/keycloak/callback?code=c&state=st`, {
						headers: { cookie },
					}),
				);
				durations.push(performance.now() - t0);
				return response;
			}),
		);

		expect(
			responses.every((r) => r.headers.get("location") === "/dashboard/home"),
		).toBe(true);
		console.info(
			`[perf] 50 concurrent callbacks p95: ${p95(durations).toFixed(2)} ms`,
		);
		expect(p95(durations)).toBeLessThan(300);
	}, 60_000);
});
