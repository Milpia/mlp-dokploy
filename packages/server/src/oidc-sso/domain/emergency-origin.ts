export const EMERGENCY_SIGN_IN_PATH = "/sign-in/email";

/**
 * The only routes where the emergency origin is trusted (spec 003 FR-004,
 * FR-005, FR-009). The second factor routes carry no email: they only work
 * with the signed `two_factor` cookie that a successful owner sign-in sets.
 */
export const EMERGENCY_ORIGIN_PATHS: ReadonlySet<string> = new Set([
	EMERGENCY_SIGN_IN_PATH,
	"/two-factor/verify-totp",
	"/two-factor/verify-backup-code",
	"/sign-out",
]);

export interface EmergencyOriginInput {
	configuredOrigin: string | null;
	method: string;
	/** `Origin`, or the origin of `Referer` when `Origin` is missing. */
	requestOrigin: string | null;
	/** Relative to better-auth's base path. */
	path: string;
	ssoOnlyActive: boolean;
	/** Only read for the sign-in route. */
	email: string | null;
	ownerEmail: string | null;
}

export type EmergencyOriginDecision =
	| { rewrite: true }
	| { rewrite: false; recordDenied: boolean };

const keep: EmergencyOriginDecision = { rewrite: false, recordDenied: false };

const normalizeEmail = (value: string | null) =>
	value?.trim().toLowerCase() || null;

/** Pure policy: every condition must hold, anything else keeps the request as is. */
export const decideEmergencyOrigin = (
	input: EmergencyOriginInput,
): EmergencyOriginDecision => {
	if (!input.configuredOrigin) return keep;
	if (input.method !== "POST") return keep;
	if (input.requestOrigin !== input.configuredOrigin) return keep;
	if (!EMERGENCY_ORIGIN_PATHS.has(input.path)) return keep;
	if (!input.ssoOnlyActive) return keep;
	if (input.path !== EMERGENCY_SIGN_IN_PATH) return { rewrite: true };

	const email = normalizeEmail(input.email);
	const owner = normalizeEmail(input.ownerEmail);
	if (email && owner && email === owner) return { rewrite: true };
	return { rewrite: false, recordDenied: true };
};
