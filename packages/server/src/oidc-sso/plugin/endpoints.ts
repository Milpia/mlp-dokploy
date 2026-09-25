import {
	APIError,
	createAuthEndpoint,
	getIp,
	getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { symmetricDecodeJWT, symmetricEncodeJWT } from "better-auth/crypto";
import * as z from "zod";
import type { LoginErrorCode } from "../types";
import {
	completeLogin,
	type LoginFlowDeps,
	type LoginTransaction,
	resolveSignOutTarget,
	startLogin,
} from "./login-flow";

export const TX_COOKIE = "oidc_sso_tx";
const TX_SALT = "dokploy.oidc-sso.tx";
const TX_MAX_AGE_SECONDS = 600;

export interface SsoEndpointDeps extends LoginFlowDeps {
	findIdToken(userId: string): Promise<string | null>;
	findOwnerEmail(): Promise<string | null>;
}

const hidden = { scope: "server" as const };

const callbackUri = (baseURL: string) =>
	`${baseURL.replace(/\/+$/, "")}/oidc/callback`;

const txCookieOptions = (baseURL: string, maxAge: number) => {
	const url = new URL(baseURL);
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		path: `${url.pathname.replace(/\/+$/, "")}/oidc`,
		secure: url.protocol === "https:",
		maxAge,
	};
};

const errorLocation = (code: LoginErrorCode, correlationId: string) =>
	`/?error=${code}&ref=${correlationId}`;

const isTransaction = (value: unknown): value is LoginTransaction => {
	const tx = value as Partial<LoginTransaction> | null;
	return (
		!!tx &&
		typeof tx.state === "string" &&
		typeof tx.nonce === "string" &&
		typeof tx.codeVerifier === "string" &&
		typeof tx.returnTo === "string"
	);
};

const readTransaction = async (
	sealed: string | null,
	secret: string,
): Promise<LoginTransaction | null> => {
	if (!sealed) return null;
	try {
		const decoded = await symmetricDecodeJWT<LoginTransaction>(
			sealed,
			secret,
			TX_SALT,
		);
		return isTransaction(decoded) ? decoded : null;
	} catch {
		return null;
	}
};

const requireActive = async (deps: LoginFlowDeps) => {
	const config = await deps.services.config.getEffective();
	// Inactive instances expose no new surface (contracts/http-endpoints.md).
	if (!config.active) throw new APIError("NOT_FOUND");
	return config;
};

export const createSsoEndpoints = (resolveDeps: () => SsoEndpointDeps) => ({
	ssoSignIn: createAuthEndpoint(
		"/oidc/sign-in",
		{
			method: "GET",
			query: z.object({ returnTo: z.string().optional() }).optional(),
			metadata: hidden,
		},
		async (ctx) => {
			const deps = resolveDeps();
			await requireActive(deps);
			const result = await startLogin(deps, {
				returnTo: ctx.query?.returnTo,
				redirectUri: callbackUri(ctx.context.baseURL),
			});
			if (!result.ok) {
				throw ctx.redirect(errorLocation(result.code, result.correlationId));
			}
			const sealed = await symmetricEncodeJWT(
				{ ...result.tx },
				ctx.context.secret,
				TX_SALT,
				TX_MAX_AGE_SECONDS,
			);
			ctx.setCookie(
				TX_COOKIE,
				sealed,
				txCookieOptions(ctx.context.baseURL, TX_MAX_AGE_SECONDS),
			);
			throw ctx.redirect(result.url);
		},
	),

	ssoCallback: createAuthEndpoint(
		"/oidc/callback",
		{
			method: "GET",
			query: z.record(z.string(), z.string()).optional(),
			metadata: hidden,
		},
		async (ctx) => {
			const deps = resolveDeps();
			await requireActive(deps);

			const tx = await readTransaction(
				ctx.getCookie(TX_COOKIE),
				ctx.context.secret,
			);
			// Single use: cleared whatever the outcome.
			ctx.setCookie(TX_COOKIE, "", txCookieOptions(ctx.context.baseURL, 0));

			const callbackUrl = new URL(callbackUri(ctx.context.baseURL));
			for (const [key, value] of Object.entries(ctx.query ?? {})) {
				callbackUrl.searchParams.set(key, value);
			}
			const ip = ctx.request
				? getIp(ctx.request, ctx.context.options)
				: undefined;

			const result = await completeLogin(deps, {
				tx,
				callbackUrl,
				redirectUri: callbackUri(ctx.context.baseURL),
				...(ip ? { ip } : {}),
			});
			if (!result.ok) {
				throw ctx.redirect(errorLocation(result.code, result.correlationId));
			}

			const user = await ctx.context.internalAdapter.findUserById(
				result.userId,
			);
			if (!user) {
				throw ctx.redirect(
					errorLocation("sso_access_denied", result.correlationId),
				);
			}
			const session = await ctx.context.internalAdapter.createSession(
				result.userId,
			);
			await setSessionCookie(ctx, { session, user });
			throw ctx.redirect(result.returnTo);
		},
	),

	/**
	 * POST so a cross-site link or image cannot sign users out; the client
	 * navigates to the returned URL (the provider's end-session page in sso-only).
	 */
	ssoSignOut: createAuthEndpoint(
		"/oidc/sign-out",
		{ method: "POST", metadata: hidden },
		async (ctx) => {
			const deps = resolveDeps();
			const session = await getSessionFromCtx(ctx);
			let idToken: string | null = null;
			if (session) {
				idToken = await deps.findIdToken(session.user.id);
				await ctx.context.internalAdapter.deleteSession(session.session.token);
			}
			deleteSessionCookie(ctx);
			const origin = new URL(ctx.context.baseURL).origin;
			const url = await resolveSignOutTarget(deps, {
				origin,
				...(idToken ? { idToken } : {}),
			});
			return ctx.json({ url });
		},
	),
});
