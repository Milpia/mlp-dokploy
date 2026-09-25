import type {
	ConfigField,
	ConfigSource,
	EffectiveConfig,
	InactiveReason,
	StoredConfig,
} from "../types";
import type { EnvOverrides } from "./env";
import type { ConfigPatch, ConfigRepository } from "./repository";

const CACHE_TTL_MS = 5_000;

const CONFIG_FIELDS: ConfigField[] = [
	"mode",
	"issuerUrl",
	"clientId",
	"clientSecret",
	"accessGroup",
	"adminGroup",
	"buttonLabel",
	"allowInsecureHttp",
];

export interface EffectiveConfigFlags {
	isCloud: boolean;
	hasEnterpriseLicense: boolean;
}

export const buildEffectiveConfig = (
	stored: StoredConfig,
	env: EnvOverrides,
	{ isCloud, hasEnterpriseLicense }: EffectiveConfigFlags,
): EffectiveConfig => {
	const sources = {} as Record<ConfigField, ConfigSource>;
	const merged: StoredConfig = { ...stored };
	for (const field of CONFIG_FIELDS) {
		const override = env.values[field];
		if (override !== undefined) {
			(merged as unknown as Record<string, unknown>)[field] = override;
			sources[field] = "env";
		} else {
			sources[field] = "db";
		}
	}

	const verified =
		!!merged.issuerUrl && merged.verifiedIssuer === merged.issuerUrl;
	// Whatever asked for sso-only (stored value or env), an unverified issuer
	// could lock everyone out, so it behaves as button mode instead (FR-011).
	if (merged.mode === "sso-only" && !verified) {
		merged.mode = "button";
	}

	const complete = !!(
		merged.issuerUrl &&
		merged.clientId &&
		merged.clientSecret
	);
	let inactiveReason: InactiveReason | undefined;
	if (isCloud) inactiveReason = "cloud";
	else if (hasEnterpriseLicense) inactiveReason = "enterprise";
	else if (merged.mode === "disabled") inactiveReason = "disabled";
	else if (!complete) inactiveReason = "incomplete";

	return {
		...merged,
		sources,
		verified,
		active: !inactiveReason,
		...(inactiveReason ? { inactiveReason } : {}),
	};
};

export interface ConfigProviderDeps {
	repository: ConfigRepository;
	env: EnvOverrides;
	isCloud: boolean;
	hasEnterpriseLicense: () => Promise<boolean>;
	now?: () => number;
}

export interface DisableSsoOnlyResult {
	changed: boolean;
	forcedByEnv: boolean;
}

/**
 * Cache-aside access to the effective configuration. The TTL bounds how long
 * other processes (or duplicated bundles) can serve a stale value; the
 * process that saves invalidates immediately.
 */
export class SsoConfigProvider {
	private cached: { value: EffectiveConfig; expiresAt: number } | null = null;
	private inflight: Promise<EffectiveConfig> | null = null;
	private readonly now: () => number;

	constructor(private readonly deps: ConfigProviderDeps) {
		this.now = deps.now ?? Date.now;
	}

	get envOverrides(): EnvOverrides {
		return this.deps.env;
	}

	async getEffective(): Promise<EffectiveConfig> {
		if (this.cached && this.cached.expiresAt > this.now()) {
			return this.cached.value;
		}
		if (!this.inflight) {
			this.inflight = this.load().finally(() => {
				this.inflight = null;
			});
		}
		return this.inflight;
	}

	getStored(): Promise<StoredConfig> {
		return this.deps.repository.get();
	}

	async save(patch: ConfigPatch): Promise<StoredConfig> {
		const saved = await this.deps.repository.save(patch);
		this.invalidate();
		return saved;
	}

	async markVerified(issuer: string): Promise<void> {
		await this.save({
			verifiedIssuer: issuer,
			verifiedAt: new Date(this.now()),
		});
	}

	async disableSsoOnlyMode(): Promise<DisableSsoOnlyResult> {
		const forcedByEnv = this.deps.env.values.mode === "sso-only";
		const stored = await this.deps.repository.get();
		if (stored.mode !== "sso-only") {
			return { changed: false, forcedByEnv };
		}
		await this.save({ mode: "button" });
		return { changed: true, forcedByEnv };
	}

	invalidate(): void {
		this.cached = null;
	}

	private async load(): Promise<EffectiveConfig> {
		const [stored, hasEnterpriseLicense] = await Promise.all([
			this.deps.repository.get(),
			this.deps.isCloud
				? Promise.resolve(false)
				: this.deps.hasEnterpriseLicense(),
		]);
		const value = buildEffectiveConfig(stored, this.deps.env, {
			isCloud: this.deps.isCloud,
			hasEnterpriseLicense,
		});
		this.cached = { value, expiresAt: this.now() + CACHE_TTL_MS };
		return value;
	}
}
