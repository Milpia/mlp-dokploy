import type { SsoMode } from "../types";

export interface TransitionContext {
	/** issuer, client id and secret are all present */
	complete: boolean;
	/** the issuer was verified by an owner login (FR-011) */
	verified: boolean;
	issuerChanged: boolean;
}

export type TransitionRefusal =
	| "incomplete"
	| "unverified"
	| "issuer_change_in_sso_only";

export type TransitionResult =
	| { ok: true }
	| { ok: false; reason: TransitionRefusal };

export const canTransitionMode = (
	from: SsoMode,
	to: SsoMode,
	{ complete, verified, issuerChanged }: TransitionContext,
): TransitionResult => {
	if (to === "disabled") return { ok: true };
	if (!complete) return { ok: false, reason: "incomplete" };
	if (to === "button") return { ok: true };

	if (from === "sso-only" && issuerChanged) {
		return { ok: false, reason: "issuer_change_in_sso_only" };
	}
	// A new issuer has never been verified, whatever the stored flag says.
	if (!verified || issuerChanged) return { ok: false, reason: "unverified" };
	return { ok: true };
};
