import { normalizeIssuerUrl } from "../config/env";
import type { ConfigPatch } from "../config/repository";
import { DEFAULT_GROUPS_CLAIM } from "../domain/claims";
import { canTransitionMode } from "../domain/mode-transition";
import { newCorrelationId } from "../events/auth-events";
import type { TestResult } from "../oidc/client";
import type { OidcSsoServices } from "../services";
import type {
	ConfigField,
	ConfigSource,
	EffectiveConfig,
	InactiveReason,
	SsoMode,
} from "../types";

export type ConfigUpdateErrorCode =
	| "env_locked"
	| "invalid_issuer"
	| "insecure_http"
	| "incomplete"
	| "unverified"
	| "issuer_change_in_sso_only";

export class ConfigUpdateError extends Error {
	constructor(
		readonly code: ConfigUpdateErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ConfigUpdateError";
	}
}

export interface ConfigUpdateInput {
	mode?: SsoMode;
	issuerUrl?: string | null;
	clientId?: string | null;
	/** Omitted or empty keeps the stored secret (write-only field). */
	clientSecret?: string;
	accessGroup?: string | null;
	adminGroup?: string | null;
	groupsClaim?: string;
	buttonLabel?: string;
	allowInsecureHttp?: boolean;
}

export interface ConfigView {
	/** What the owner asked for; may differ from effectiveMode (see FR-011). */
	mode: SsoMode;
	effectiveMode: SsoMode;
	issuerUrl: string | null;
	clientId: string | null;
	hasClientSecret: boolean;
	accessGroup: string | null;
	adminGroup: string | null;
	groupsClaim: string;
	buttonLabel: string;
	allowInsecureHttp: boolean;
	verified: boolean;
	active: boolean;
	inactiveReason: InactiveReason | null;
	sources: Record<ConfigField, ConfigSource>;
	envErrors: string[];
}

export interface Actor {
	userId: string;
	email: string;
	ip?: string;
}

const desiredMode = (services: OidcSsoServices, stored: SsoMode) =>
	services.config.envOverrides.values.mode ?? stored;

const toView = (
	services: OidcSsoServices,
	effective: EffectiveConfig,
	storedMode: SsoMode,
): ConfigView => ({
	mode: desiredMode(services, storedMode),
	effectiveMode: effective.active ? effective.mode : "disabled",
	issuerUrl: effective.issuerUrl,
	clientId: effective.clientId,
	hasClientSecret: !!effective.clientSecret,
	accessGroup: effective.accessGroup,
	adminGroup: effective.adminGroup,
	groupsClaim: effective.groupsClaim,
	buttonLabel: effective.buttonLabel,
	allowInsecureHttp: effective.allowInsecureHttp,
	verified: effective.verified,
	active: effective.active,
	inactiveReason: effective.inactiveReason ?? null,
	sources: effective.sources,
	envErrors: services.config.envOverrides.errors,
});

export const getConfigView = async (
	services: OidcSsoServices,
): Promise<ConfigView> => {
	const [effective, stored] = await Promise.all([
		services.config.getEffective(),
		services.config.getStored(),
	]);
	return toView(services, effective, stored.mode);
};

const blankToNull = (value: string | null | undefined) =>
	value === undefined ? undefined : value?.trim() ? value.trim() : null;

const TRANSITION_MESSAGES: Record<
	"incomplete" | "unverified" | "issuer_change_in_sso_only",
	string
> = {
	incomplete:
		"Set the issuer URL, client ID and client secret before enabling single sign-on.",
	unverified:
		"Sign in once through the identity provider using the owner account before enabling SSO-only mode.",
	issuer_change_in_sso_only:
		"Switch to button mode before changing the issuer URL.",
};

export const updateSsoConfig = async (
	services: OidcSsoServices,
	input: ConfigUpdateInput,
	actor: Actor,
): Promise<ConfigView> => {
	services.config.invalidate();
	const [effective, stored] = await Promise.all([
		services.config.getEffective(),
		services.config.getStored(),
	]);

	const patch: ConfigPatch = {};
	const requested: Partial<Record<ConfigField, unknown>> = {
		...(input.mode !== undefined ? { mode: input.mode } : {}),
		...(input.issuerUrl !== undefined
			? { issuerUrl: blankToNull(input.issuerUrl) }
			: {}),
		...(input.clientId !== undefined
			? { clientId: blankToNull(input.clientId) }
			: {}),
		...(input.clientSecret?.trim()
			? { clientSecret: input.clientSecret.trim() }
			: {}),
		...(input.accessGroup !== undefined
			? { accessGroup: blankToNull(input.accessGroup) }
			: {}),
		...(input.adminGroup !== undefined
			? { adminGroup: blankToNull(input.adminGroup) }
			: {}),
		...(input.groupsClaim !== undefined
			? { groupsClaim: input.groupsClaim.trim() || DEFAULT_GROUPS_CLAIM }
			: {}),
		...(input.buttonLabel !== undefined
			? { buttonLabel: input.buttonLabel.trim() }
			: {}),
		...(input.allowInsecureHttp !== undefined
			? { allowInsecureHttp: input.allowInsecureHttp }
			: {}),
	};

	for (const [field, value] of Object.entries(requested) as [
		ConfigField,
		unknown,
	][]) {
		if (effective.sources[field] !== "env") continue;
		const current =
			field === "mode" ? desiredMode(services, stored.mode) : effective[field];
		if (value !== current) {
			throw new ConfigUpdateError(
				"env_locked",
				`${field} is set by an environment variable and cannot be changed here.`,
			);
		}
		delete requested[field];
	}

	if (typeof requested.issuerUrl === "string") {
		const normalized = normalizeIssuerUrl(requested.issuerUrl);
		if (!normalized) {
			throw new ConfigUpdateError(
				"invalid_issuer",
				"The issuer URL must be an absolute http(s) URL.",
			);
		}
		requested.issuerUrl = normalized;
	}
	Object.assign(patch, requested);

	const next = {
		issuerUrl:
			"issuerUrl" in requested
				? (requested.issuerUrl as string | null)
				: effective.issuerUrl,
		clientId:
			"clientId" in requested
				? (requested.clientId as string | null)
				: effective.clientId,
		clientSecret:
			"clientSecret" in requested
				? (requested.clientSecret as string)
				: effective.clientSecret,
		allowInsecureHttp:
			"allowInsecureHttp" in requested
				? (requested.allowInsecureHttp as boolean)
				: effective.allowInsecureHttp,
	};

	if (next.issuerUrl?.startsWith("http:") && !next.allowInsecureHttp) {
		throw new ConfigUpdateError(
			"insecure_http",
			"The issuer uses plain HTTP. Use HTTPS, or allow insecure HTTP for development only.",
		);
	}

	const fromMode = desiredMode(services, stored.mode);
	const toMode = (requested.mode as SsoMode | undefined) ?? fromMode;
	const issuerChanged = next.issuerUrl !== effective.issuerUrl;
	const transition = canTransitionMode(fromMode, toMode, {
		complete: !!(next.issuerUrl && next.clientId && next.clientSecret),
		verified: !!next.issuerUrl && stored.verifiedIssuer === next.issuerUrl,
		issuerChanged,
	});
	if (!transition.ok) {
		throw new ConfigUpdateError(
			transition.reason,
			TRANSITION_MESSAGES[transition.reason],
		);
	}
	if (issuerChanged) {
		patch.verifiedIssuer = null;
		patch.verifiedAt = null;
	}

	const saved = await services.config.save(patch);
	services.oidc.reset();

	const correlationId = newCorrelationId();
	const changedFields = Object.keys(requested).filter((f) => f !== "mode");
	if (changedFields.length > 0) {
		await services.events.record({
			type: "config_change",
			outcome: "success",
			// Field names only; values (and the secret) never reach the log.
			reason: changedFields.sort().join(","),
			userId: actor.userId,
			email: actor.email,
			correlationId,
			...(actor.ip ? { ip: actor.ip } : {}),
		});
	}
	if (toMode !== fromMode) {
		await services.events.record({
			type: "mode_change",
			outcome: "success",
			reason: `${fromMode}->${toMode}`,
			userId: actor.userId,
			email: actor.email,
			correlationId,
			...(actor.ip ? { ip: actor.ip } : {}),
		});
	}

	const refreshed = await services.config.getEffective();
	return toView(services, refreshed, saved.mode);
};

export const testSsoConnection = async (
	services: OidcSsoServices,
	input: Pick<
		ConfigUpdateInput,
		"issuerUrl" | "clientId" | "clientSecret" | "allowInsecureHttp"
	>,
): Promise<TestResult> => {
	const effective = await services.config.getEffective();
	const issuerUrl = blankToNull(input.issuerUrl) ?? effective.issuerUrl;
	const clientId = blankToNull(input.clientId) ?? effective.clientId;
	const clientSecret = input.clientSecret?.trim() || effective.clientSecret;
	if (!issuerUrl || !clientId || !clientSecret) {
		return {
			ok: false,
			code: "invalid_url",
			message: "Issuer URL, client ID and client secret are required.",
		};
	}
	return services.oidc.testConnection({
		issuerUrl: normalizeIssuerUrl(issuerUrl) ?? issuerUrl,
		clientId,
		clientSecret,
		allowInsecureHttp: input.allowInsecureHttp ?? effective.allowInsecureHttp,
	});
};

export const getPublicConfig = async (
	services: OidcSsoServices,
): Promise<{ mode: SsoMode; buttonLabel: string }> => {
	const effective = await services.config.getEffective();
	return {
		mode: effective.active ? effective.mode : "disabled",
		buttonLabel: effective.buttonLabel,
	};
};
