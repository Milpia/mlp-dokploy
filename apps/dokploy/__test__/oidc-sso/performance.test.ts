import { DEFAULT_STORED_CONFIG } from "@dokploy/server/oidc-sso/config/repository";
import { createEmergencyOriginHandler } from "@dokploy/server/oidc-sso/plugin/emergency-origin";
import { oidcSso } from "@dokploy/server/oidc-sso/plugin/index";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";
import { ISSUER, makeDeps } from "./helpers";

const BASE = "http://localhost:3000";
const SECRET = "test-secret-that-is-long-enough-for-better-auth";

const p95 = (samples: number[]) => {
	const sorted = [...samples].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
	);
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
	it("NFR-PERF-001/SC-009: with the feature disabled, the plugin adds under 5 ms p95 and no provider call", async () => {
		const built = makeDeps({ config: DEFAULT_STORED_CONFIG });
		const withPlugin = betterAuth({
			baseURL: BASE,
			secret: SECRET,
			database: memoryAdapter(memory()),
			rateLimit: { enabled: false },
			logger: { disabled: true },
			emailAndPassword: { enabled: true },
			plugins: [oidcSso({ resolveDeps: () => built.deps })],
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

		// Interleaved so both variants see the same CPU load when the whole
		// suite runs in parallel.
		const without: number[] = [];
		const withIt: number[] = [];
		for (let i = 0; i < 20; i++) {
			await withoutPlugin.handler(request());
			await withPlugin.handler(request());
		}
		for (let i = 0; i < 300; i++) {
			let t0 = performance.now();
			await withoutPlugin.handler(request());
			without.push(performance.now() - t0);
			t0 = performance.now();
			await withPlugin.handler(request());
			withIt.push(performance.now() - t0);
		}
		const baseline = p95(without);
		const current = p95(withIt);

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
			plugins: [oidcSso({ resolveDeps: () => built.deps })],
		});

		const start = await auth.handler(
			new Request(`${BASE}/api/auth/oidc/sign-in`),
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
					new Request(`${BASE}/api/auth/oidc/callback?code=c&state=st`, {
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

	it("spec 003 NFR-PERF-001/002: the emergency origin check costs nothing outside the tunnel", async () => {
		const TUNNEL = "http://localhost:3900";
		const context = { baseURL: `${BASE}/api/auth`, options: {} };
		const request = (origin: string, path = "/sign-in/email") =>
			new Request(`${BASE}/api/auth${path}`, {
				method: "POST",
				headers: { "content-type": "application/json", origin },
				body: JSON.stringify({ email: "dev@example.com" }),
			});
		const measure = async (
			handler: ReturnType<typeof createEmergencyOriginHandler>,
			make: () => Request,
		) => {
			const samples: number[] = [];
			for (let i = 0; i < 500; i++) {
				const req = make();
				const t0 = performance.now();
				await handler(req, context);
				samples.push(performance.now() - t0);
			}
			return p95(samples);
		};

		const off = makeDeps({ emergencyOrigin: null });
		const on = makeDeps({ emergencyOrigin: TUNNEL });
		await on.repository.save({ mode: "sso-only", verifiedIssuer: ISSUER });
		const offReads = vi.spyOn(off.services.config, "getEffective");
		const onReads = vi.spyOn(on.services.config, "getEffective");

		const disabled = await measure(
			createEmergencyOriginHandler(() => off.deps),
			() => request(TUNNEL),
		);
		const otherOrigin = await measure(
			createEmergencyOriginHandler(() => on.deps),
			() => request(BASE),
		);
		expect(offReads).not.toHaveBeenCalled();
		expect(onReads).not.toHaveBeenCalled();
		expect(off.deps.findOwnerEmail).not.toHaveBeenCalled();

		const emergencyPath = await measure(
			createEmergencyOriginHandler(() => on.deps),
			() => request(TUNNEL, "/sign-out"),
		);
		console.info(
			`[perf] emergency origin onRequest p95: disabled ${disabled.toFixed(3)} ms, other origin ${otherOrigin.toFixed(3)} ms, tunnel sign-out ${emergencyPath.toFixed(3)} ms`,
		);
		expect(disabled).toBeLessThan(1);
		expect(otherOrigin).toBeLessThan(1);
		expect(emergencyPath).toBeLessThan(5);
	}, 60_000);
});
