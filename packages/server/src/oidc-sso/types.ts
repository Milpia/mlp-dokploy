export const SSO_MODES = ["disabled", "button", "sso-only"] as const;
export type SsoMode = (typeof SSO_MODES)[number];

export type SsoRole = "admin" | "member";

export const SSO_PROVIDER_ID = "oidc";

export type DenyReason =
	| "email_missing"
	| "email_unverified"
	| "not_in_access_group"
	| "provisioning_disabled"
	| "user_banned"
	| "no_owner"
	| "identity_conflict";

export const LOGIN_ERROR_CODES = [
	"sso_cancelled",
	"sso_invalid_response",
	"sso_email_unverified",
	"sso_access_denied",
	"sso_unavailable",
	"sso_clock_skew",
] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export type AuthEventType =
	| "sso_login"
	| "emergency_login"
	| "config_change"
	| "mode_change";

export type AuthEventOutcome = "success" | "denied" | "error";

export type ConfigField =
	| "mode"
	| "issuerUrl"
	| "clientId"
	| "clientSecret"
	| "accessGroup"
	| "adminGroup"
	| "groupsClaim"
	| "buttonLabel"
	| "allowInsecureHttp";

export type ConfigSource = "env" | "db";

export interface StoredConfig {
	mode: SsoMode;
	issuerUrl: string | null;
	clientId: string | null;
	clientSecret: string | null;
	accessGroup: string | null;
	adminGroup: string | null;
	groupsClaim: string;
	buttonLabel: string;
	allowInsecureHttp: boolean;
	verifiedIssuer: string | null;
	verifiedAt: Date | null;
}

export type InactiveReason = "disabled" | "incomplete" | "enterprise" | "cloud";

export interface EffectiveConfig extends StoredConfig {
	sources: Record<ConfigField, ConfigSource>;
	active: boolean;
	inactiveReason?: InactiveReason;
	/** True when the stored issuer was verified by an owner login (FR-011). */
	verified: boolean;
}

export class SsoLoginError extends Error {
	constructor(
		readonly code: LoginErrorCode,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "SsoLoginError";
	}
}
