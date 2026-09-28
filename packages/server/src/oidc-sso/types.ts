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
	"sso_identity_mismatch",
	"sso_unavailable",
	"sso_clock_skew",
] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export type AuthEventType =
	| "sso_login"
	| "emergency_login"
	| "config_change"
	| "mode_change"
	| "user_management"
	| "member_profile";

export type AuthEventOutcome = "success" | "denied" | "error";

/** Every way the server lets someone manage other users (spec 002, FR-004). */
export type UserManagementAction =
	| "remove_user"
	| "remove_member"
	| "invite"
	| "create_user"
	| "resend_invitation"
	| "cancel_invitation"
	| "change_role"
	| "change_permissions"
	| "manage_roles";

export type UserManagementDenyReason =
	| "no_sso_login"
	| "grant_expired"
	| "not_in_group"
	| "check_failed";

/** Upstream member columns a group profile may grant (spec 005, FR-008). */
export const MEMBER_PERMISSIONS = [
	"canCreateProjects",
	"canDeleteProjects",
	"canCreateServices",
	"canDeleteServices",
	"canCreateEnvironments",
	"canDeleteEnvironments",
	"canAccessToDocker",
	"canAccessToAPI",
	"canAccessToSSHKeys",
	"canAccessToGitProviders",
	"canAccessToTraefikFiles",
] as const;
export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

export type EnvironmentFilter = { include: string[] } | { exclude: string[] };

export interface GroupProfile {
	group: string;
	permissions: MemberPermission[];
	projects: string[];
	environments?: EnvironmentFilter;
}

export type MemberProfileReason = "profile_expired" | "profile_failed";

export type ConfigField =
	| "mode"
	| "issuerUrl"
	| "clientId"
	| "clientSecret"
	| "accessGroup"
	| "adminGroup"
	| "userManagementGroup"
	| "groupProfiles"
	| "groupsClaim"
	| "extraScopes"
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
	/** Only these groups (and the owner) may manage users (spec 002). */
	userManagementGroup: string | null;
	/** JSON of per-group member profiles (spec 005); null disables them. */
	groupProfiles: string | null;
	groupsClaim: string;
	/** Space-separated, appended to "openid email profile". */
	extraScopes: string;
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
