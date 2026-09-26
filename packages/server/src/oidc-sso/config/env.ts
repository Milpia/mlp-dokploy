import { readFileSync } from "node:fs";
import { parseScopes } from "../domain/scopes";
import { SSO_MODES, type SsoMode } from "../types";

export interface EnvOverrideValues {
	mode?: SsoMode;
	issuerUrl?: string;
	clientId?: string;
	clientSecret?: string;
	accessGroup?: string;
	adminGroup?: string;
	userManagementGroup?: string;
	groupsClaim?: string;
	extraScopes?: string;
	buttonLabel?: string;
	allowInsecureHttp?: boolean;
}

export interface EnvOverrides {
	values: EnvOverrideValues;
	errors: string[];
	/** Not a stored config field: it only exists in the environment (spec 003). */
	emergencyOrigin?: string;
}

export const BUTTON_LABEL_MAX_LENGTH = 64;
export const GROUP_LIST_MAX_LENGTH = 512;

type Env = Record<string, string | undefined>;
type FileReader = (path: string) => string;

const read = (env: Env, name: string): string | undefined => {
	const value = env[name]?.trim();
	return value ? value : undefined;
};

export const normalizeIssuerUrl = (value: string): string | null => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	return url.toString().replace(/\/+$/, "");
};

/**
 * better-auth accepts wildcards in trusted origins, so only a value that is
 * already its own origin is allowed: that rules out paths, queries, trailing
 * slashes, credentials and patterns in one check.
 */
export const parseExactOrigin = (value: string): string | null => {
	if (value.includes("*")) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	return url.origin === value ? value : null;
};

/**
 * Environment variables take precedence over the stored configuration
 * (FR-019). Invalid values are reported and ignored so a typo can never take
 * precedence over a valid stored value.
 */
export const readEnvOverrides = (
	env: Env = process.env,
	readFile: FileReader = (path) => readFileSync(path, "utf8"),
): EnvOverrides => {
	const values: EnvOverrideValues = {};
	const errors: string[] = [];

	const mode = read(env, "SSO_OIDC_MODE");
	if (mode) {
		if ((SSO_MODES as readonly string[]).includes(mode)) {
			values.mode = mode as SsoMode;
		} else {
			errors.push(
				`SSO_OIDC_MODE must be one of ${SSO_MODES.join(", ")}; ignoring it.`,
			);
		}
	}

	const issuerUrl = read(env, "SSO_OIDC_ISSUER_URL");
	if (issuerUrl) {
		const normalized = normalizeIssuerUrl(issuerUrl);
		if (normalized) {
			values.issuerUrl = normalized;
		} else {
			errors.push(
				"SSO_OIDC_ISSUER_URL must be an absolute http(s) URL; ignoring it.",
			);
		}
	}

	const clientId = read(env, "SSO_OIDC_CLIENT_ID");
	if (clientId) values.clientId = clientId;

	const inlineSecret = read(env, "SSO_OIDC_CLIENT_SECRET");
	const secretFile = read(env, "SSO_OIDC_CLIENT_SECRET_FILE");
	if (inlineSecret) {
		values.clientSecret = inlineSecret;
	} else if (secretFile) {
		try {
			const fromFile = readFile(secretFile).trim();
			if (fromFile) values.clientSecret = fromFile;
		} catch {
			// The path is safe to log; the file contents never are.
			errors.push(
				`SSO_OIDC_CLIENT_SECRET_FILE could not be read (${secretFile}); ignoring it.`,
			);
		}
	}

	const accessGroup = read(env, "SSO_OIDC_ACCESS_GROUP");
	if (accessGroup) values.accessGroup = accessGroup;

	const adminGroup = read(env, "SSO_OIDC_ADMIN_GROUP");
	if (adminGroup) values.adminGroup = adminGroup;

	const userManagementGroup = read(env, "SSO_OIDC_USER_MANAGEMENT_GROUP");
	if (userManagementGroup) {
		if (userManagementGroup.length <= GROUP_LIST_MAX_LENGTH) {
			values.userManagementGroup = userManagementGroup;
		} else {
			errors.push(
				`SSO_OIDC_USER_MANAGEMENT_GROUP must be at most ${GROUP_LIST_MAX_LENGTH} characters; ignoring it.`,
			);
		}
	}

	const groupsClaim = read(env, "SSO_OIDC_GROUPS_CLAIM");
	if (groupsClaim) values.groupsClaim = groupsClaim;

	const extraScopes = read(env, "SSO_OIDC_EXTRA_SCOPES");
	if (extraScopes) {
		const scopes = parseScopes(extraScopes);
		if (scopes) {
			values.extraScopes = scopes.join(" ");
		} else {
			errors.push(
				"SSO_OIDC_EXTRA_SCOPES contains characters not allowed in OAuth scopes; ignoring it.",
			);
		}
	}

	const buttonLabel = read(env, "SSO_OIDC_BUTTON_LABEL");
	if (buttonLabel) {
		if (buttonLabel.length <= BUTTON_LABEL_MAX_LENGTH) {
			values.buttonLabel = buttonLabel;
		} else {
			errors.push(
				`SSO_OIDC_BUTTON_LABEL must be at most ${BUTTON_LABEL_MAX_LENGTH} characters; ignoring it.`,
			);
		}
	}

	const allowInsecure = read(env, "SSO_OIDC_ALLOW_INSECURE_HTTP");
	if (allowInsecure) {
		if (allowInsecure === "true" || allowInsecure === "false") {
			values.allowInsecureHttp = allowInsecure === "true";
		} else {
			errors.push(
				"SSO_OIDC_ALLOW_INSECURE_HTTP must be true or false; ignoring it.",
			);
		}
	}

	const emergencyOrigin = read(env, "SSO_OIDC_EMERGENCY_ORIGIN");
	let parsedEmergencyOrigin: string | undefined;
	if (emergencyOrigin) {
		const exact = parseExactOrigin(emergencyOrigin);
		if (exact) {
			parsedEmergencyOrigin = exact;
		} else {
			errors.push(
				"SSO_OIDC_EMERGENCY_ORIGIN must be an exact http(s) origin without path or wildcards; ignoring it.",
			);
		}
	}

	return {
		values,
		errors,
		...(parsedEmergencyOrigin
			? { emergencyOrigin: parsedEmergencyOrigin }
			: {}),
	};
};
