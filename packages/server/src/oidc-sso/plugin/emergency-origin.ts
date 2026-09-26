import { getIp } from "better-auth/api";
import {
	decideEmergencyOrigin,
	EMERGENCY_SIGN_IN_PATH,
	isEmergencyCandidate,
} from "../domain/emergency-origin";
import { newCorrelationId } from "../events/auth-events";
import type { SsoEndpointDeps } from "./endpoints";

/**
 * Set only by this plugin; any copy sent by a client is removed first. "1"
 * means the origin was rewritten; "denied" that the attempt is already recorded.
 */
export const EMERGENCY_ORIGIN_HEADER = "x-oidc-sso-emergency-origin";
export const EMERGENCY_ORIGIN_DENIED = "denied";

export interface RequestContext {
	baseURL: string;
	options: Parameters<typeof getIp>[1];
}

type OnRequestResult = { request: Request } | undefined;

const originOf = (value: string | null): string | null => {
	if (!value) return null;
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
};

const readEmail = async (request: Request): Promise<string | null> => {
	const body = (await request.clone().json()) as { email?: unknown } | null;
	return typeof body?.email === "string" ? body.email : null;
};

const withHeaders = (request: Request, headers: Headers): Request =>
	new Request(request, { headers, duplex: "half" } as RequestInit);

/**
 * better-auth checks the Origin header in its router, before any plugin hook
 * (research R1), so the only way to trust the emergency origin for a handful
 * of owner requests is to rewrite that header here, per request. Anything
 * unexpected leaves the request as it came, which better-auth then rejects.
 */
export const createEmergencyOriginHandler =
	(resolveDeps: () => SsoEndpointDeps) =>
	async (
		request: Request,
		context: RequestContext,
	): Promise<OnRequestResult> => {
		const incoming = new Headers(request.headers);
		const forgedMarker = incoming.has(EMERGENCY_ORIGIN_HEADER);
		incoming.delete(EMERGENCY_ORIGIN_HEADER);
		const untouched = (): OnRequestResult =>
			forgedMarker ? { request: withHeaders(request, incoming) } : undefined;

		const deps = resolveDeps();
		const configuredOrigin = deps.services.emergencyOrigin;
		if (!configuredOrigin || !context.baseURL) return untouched();

		let publicOrigin: string;
		let basePath: string;
		try {
			const base = new URL(context.baseURL);
			publicOrigin = base.origin;
			basePath = base.pathname.replace(/\/+$/, "");
		} catch {
			return untouched();
		}

		const pathname = new URL(request.url).pathname;
		if (!pathname.startsWith(`${basePath}/`)) return untouched();
		const path = pathname.slice(basePath.length);
		const requestOrigin =
			originOf(request.headers.get("origin")) ??
			originOf(request.headers.get("referer"));
		const candidate = {
			configuredOrigin,
			method: request.method,
			requestOrigin,
			path,
		};
		if (!isEmergencyCandidate(candidate)) return untouched();

		try {
			const isSignIn = path === EMERGENCY_SIGN_IN_PATH;
			const [email, ownerEmail] = isSignIn
				? await Promise.all([readEmail(request), deps.findOwnerEmail()])
				: [null, null];
			const decision = decideEmergencyOrigin({
				...candidate,
				email,
				ownerEmail,
			});

			if (decision.rewrite) {
				incoming.set("origin", publicOrigin);
				incoming.delete("referer");
				incoming.set(EMERGENCY_ORIGIN_HEADER, "1");
				return { request: withHeaders(request, incoming) };
			}
			if (decision.recordDenied) {
				const ip = getIp(request, context.options);
				await deps.services.events.record({
					type: "emergency_login",
					outcome: "denied",
					reason: "not_owner",
					correlationId: newCorrelationId(),
					emergencyOrigin: true,
					...(email ? { email: email.trim().toLowerCase() } : {}),
					...(ip ? { ip } : {}),
				});
				// Without cookies better-auth checks the origin only after the hooks,
				// so the SSO-only guard would record the same attempt again (MIL-497).
				incoming.set(EMERGENCY_ORIGIN_HEADER, EMERGENCY_ORIGIN_DENIED);
				return { request: withHeaders(request, incoming) };
			}
		} catch (error) {
			console.error("OIDC SSO: emergency origin check failed", error);
		}
		return untouched();
	};
