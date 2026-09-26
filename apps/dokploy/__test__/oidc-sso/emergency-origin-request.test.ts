import {
	createEmergencyOriginHandler,
	EMERGENCY_ORIGIN_HEADER,
} from "@dokploy/server/oidc-sso/plugin/emergency-origin";
import { describe, expect, it, vi } from "vitest";
import { ISSUER, makeDeps } from "./helpers";

const BASE = "https://deploy.example.test";
const TUNNEL = "http://localhost:3900";
const context = { baseURL: `${BASE}/api/auth`, options: {} };

const request = (
	path: string,
	{
		origin = TUNNEL as string | null,
		referer = null as string | null,
		body = { email: "owner@example.com", password: "x" } as unknown,
		method = "POST",
		extra = {} as Record<string, string>,
	} = {},
) => {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		cookie: "dev_app_session=1",
		...extra,
	};
	if (origin) headers.origin = origin;
	if (referer) headers.referer = referer;
	return new Request(`${BASE}/api/auth${path}`, {
		method,
		headers,
		...(method === "GET" ? {} : { body: JSON.stringify(body) }),
	});
};

const setup = async ({
	emergencyOrigin = TUNNEL as string | null,
	ssoOnly = true,
	ownerEmail = "owner@example.com" as string | null,
} = {}) => {
	const built = makeDeps({ emergencyOrigin, ownerEmail });
	if (ssoOnly) {
		await built.repository.save({ mode: "sso-only", verifiedIssuer: ISSUER });
	}
	const handler = createEmergencyOriginHandler(() => built.deps);
	return { ...built, handler };
};

const rewritten = async (
	result: Awaited<ReturnType<ReturnType<typeof createEmergencyOriginHandler>>>,
) => {
	expect(result && "request" in result).toBe(true);
	return (result as { request: Request }).request;
};

describe("emergency origin onRequest adapter (spec 003)", () => {
	it("FR-004: rewrites Origin to the public origin, drops Referer and marks the request", async () => {
		const { handler } = await setup();
		const original = request("/sign-in/email", {
			referer: `${TUNNEL}/?emergency=1`,
			extra: { "x-forwarded-for": "127.0.0.1" },
		});
		const next = await rewritten(await handler(original, context));

		expect(next.headers.get("origin")).toBe(BASE);
		expect(next.headers.get("referer")).toBeNull();
		expect(next.headers.get(EMERGENCY_ORIGIN_HEADER)).toBe("1");
		expect(next.method).toBe("POST");
		expect(next.url).toBe(original.url);
		expect(next.headers.get("cookie")).toBe("dev_app_session=1");
		expect(next.headers.get("x-forwarded-for")).toBe("127.0.0.1");
		expect(await next.json()).toEqual({
			email: "owner@example.com",
			password: "x",
		});
	});

	it("FR-004: falls back to the Referer origin when Origin is missing", async () => {
		const { handler } = await setup();
		const next = await rewritten(
			await handler(
				request("/sign-in/email", {
					origin: null,
					referer: `${TUNNEL}/?emergency=1`,
				}),
				context,
			),
		);
		expect(next.headers.get("origin")).toBe(BASE);
	});

	it.each([
		"/two-factor/verify-totp",
		"/two-factor/verify-backup-code",
		"/sign-out",
	])(
		"FR-005/FR-009: rewrites %s without reading the owner email",
		async (path) => {
			const { handler, deps } = await setup();
			const next = await rewritten(
				await handler(request(path, { body: { code: "123456" } }), context),
			);
			expect(next.headers.get("origin")).toBe(BASE);
			expect(deps.findOwnerEmail).not.toHaveBeenCalled();
		},
	);

	it("NFR-PERF-001: without the setting it returns nothing and calls no dependency", async () => {
		const { handler, deps } = await setup({ emergencyOrigin: null });
		const getEffective = vi.spyOn(deps.services.config, "getEffective");
		expect(await handler(request("/sign-in/email"), context)).toBeUndefined();
		expect(getEffective).not.toHaveBeenCalled();
		expect(deps.findOwnerEmail).not.toHaveBeenCalled();
	});

	it("NFR-PERF-002: a different origin returns nothing without reading config", async () => {
		const { handler, deps } = await setup();
		const getEffective = vi.spyOn(deps.services.config, "getEffective");
		expect(
			await handler(
				request("/sign-in/email", { origin: "https://evil.example.com" }),
				context,
			),
		).toBeUndefined();
		expect(getEffective).not.toHaveBeenCalled();
	});

	it("SC-003: outside sso-only the request is left alone", async () => {
		const { handler } = await setup({ ssoOnly: false });
		expect(await handler(request("/sign-in/email"), context)).toBeUndefined();
	});

	it("FR-004: paths are matched relative to the auth base path", async () => {
		const { handler } = await setup();
		const other = new Request(`${BASE}/sign-in/email`, {
			method: "POST",
			headers: { origin: TUNNEL, "content-type": "application/json" },
			body: JSON.stringify({ email: "owner@example.com" }),
		});
		expect(await handler(other, context)).toBeUndefined();
	});

	it("NFR-SEC-001: a client-supplied marker header is always stripped", async () => {
		const { handler } = await setup({ emergencyOrigin: null });
		const next = await rewritten(
			await handler(
				request("/sign-in/email", {
					origin: BASE,
					extra: { [EMERGENCY_ORIGIN_HEADER]: "1" },
				}),
				context,
			),
		);
		expect(next.headers.get(EMERGENCY_ORIGIN_HEADER)).toBeNull();
		expect(next.headers.get("origin")).toBe(BASE);
	});

	it("NFR-SEC-002: a failing config read leaves the request as it came", async () => {
		const { handler, deps } = await setup();
		vi.spyOn(deps.services.config, "getEffective").mockRejectedValue(
			new Error("db down"),
		);
		const logError = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await handler(request("/sign-in/email"), context)).toBeUndefined();
		expect(logError).toHaveBeenCalled();
		logError.mockRestore();
	});

	it("NFR-SEC-002: an unreadable body leaves the request as it came", async () => {
		const { handler } = await setup();
		const broken = new Request(`${BASE}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { origin: TUNNEL, "content-type": "application/json" },
			body: "{not json",
		});
		expect(await handler(broken, context)).toBeUndefined();
	});

	it("NFR-SEC-002: without a public base URL nothing is rewritten", async () => {
		const { handler } = await setup();
		expect(
			await handler(request("/sign-in/email"), { baseURL: "", options: {} }),
		).toBeUndefined();
	});

	it("NFR-SEC-002: an opaque or malformed Origin is never trusted", async () => {
		const { handler } = await setup();
		expect(
			await handler(
				request("/sign-in/email", { origin: "null", referer: "::bad::" }),
				context,
			),
		).toBeUndefined();
	});

	it("NFR-SEC-002: an unparsable base URL leaves the request alone", async () => {
		const { handler } = await setup();
		expect(
			await handler(request("/sign-in/email"), {
				baseURL: "not a url",
				options: {},
			}),
		).toBeUndefined();
	});

	it("FR-007: a sign-in without an email is recorded as a denied emergency attempt", async () => {
		const { handler, recorded } = await setup();
		const withoutIpTracking = {
			...context,
			options: { advanced: { ipAddress: { disableIpTracking: true } } },
		};
		expect(
			await handler(request("/sign-in/email", { body: {} }), withoutIpTracking),
		).toBeUndefined();
		expect(recorded.at(-1)).toEqual(
			expect.objectContaining({
				type: "emergency_login",
				outcome: "denied",
				reason: "not_owner",
				emergencyOrigin: true,
			}),
		);
		expect(recorded.at(-1)).not.toHaveProperty("email");
		expect(recorded.at(-1)).not.toHaveProperty("ip");
	});
});
