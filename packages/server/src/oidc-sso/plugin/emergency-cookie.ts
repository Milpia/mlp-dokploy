import { createAuthMiddleware } from "better-auth/api";
import { EMERGENCY_ORIGIN_HEADER } from "./emergency-origin";

const withoutSecure = (cookie: string) =>
	cookie.replace(/;\s*Secure(?=;|$)/i, "");

/**
 * The emergency origin is a plain http tunnel to the instance (spec 003), so a
 * `Secure` cookie would never come back through it and the owner could not
 * stay signed in. Only the plugin's onRequest can set the marker header.
 */
export const emergencyCookieHook = {
	matcher: (ctx: { request?: Request }) =>
		ctx.request?.headers.get(EMERGENCY_ORIGIN_HEADER) === "1",
	handler: createAuthMiddleware(async (ctx) => {
		const headers = ctx.context.responseHeaders;
		const cookies = headers?.getSetCookie() ?? [];
		if (!headers || cookies.length === 0) return;
		headers.delete("set-cookie");
		for (const cookie of cookies) {
			headers.append("set-cookie", withoutSecure(cookie));
		}
	}),
};
