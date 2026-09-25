import { db } from "@dokploy/server/db";
import { oidcSsoConfig } from "@dokploy/server/db/schema";
import { decryptValue, encryptValue } from "@dokploy/server/lib/encryption";
import { eq } from "drizzle-orm";
import type { StoredConfig } from "../types";

export type ConfigPatch = Partial<
	Omit<StoredConfig, "clientSecret"> & { clientSecret: string | null }
>;

export interface ConfigRepository {
	get(): Promise<StoredConfig>;
	save(patch: ConfigPatch): Promise<StoredConfig>;
}

export const DEFAULT_STORED_CONFIG: StoredConfig = {
	mode: "disabled",
	issuerUrl: null,
	clientId: null,
	clientSecret: null,
	accessGroup: null,
	adminGroup: null,
	groupsClaim: "groups",
	buttonLabel: "Sign in with SSO",
	allowInsecureHttp: false,
	verifiedIssuer: null,
	verifiedAt: null,
};

type Row = typeof oidcSsoConfig.$inferSelect;

const decryptSecret = (stored: string | null): string | null => {
	if (!stored) return null;
	try {
		return decryptValue(stored);
	} catch {
		// A rotated encryption key makes the secret unusable; treating it as
		// missing marks the configuration incomplete instead of failing logins
		// with an opaque error.
		console.error(
			"OIDC SSO: the stored client secret could not be decrypted; re-enter it in the settings.",
		);
		return null;
	}
};

const toStoredConfig = (row: Row): StoredConfig => ({
	mode: row.mode,
	issuerUrl: row.issuerUrl,
	clientId: row.clientId,
	clientSecret: decryptSecret(row.clientSecret),
	accessGroup: row.accessGroup,
	adminGroup: row.adminGroup,
	groupsClaim: row.groupsClaim,
	buttonLabel: row.buttonLabel,
	allowInsecureHttp: row.allowInsecureHttp,
	verifiedIssuer: row.verifiedIssuer,
	verifiedAt: row.verifiedAt,
});

const findRow = () =>
	db.query.oidcSsoConfig.findFirst({
		orderBy: (config, { asc }) => [asc(config.createdAt)],
	});

export const drizzleConfigRepository: ConfigRepository = {
	async get() {
		const row = await findRow();
		return row ? toStoredConfig(row) : { ...DEFAULT_STORED_CONFIG };
	},

	async save(patch) {
		const { clientSecret, ...rest } = patch;
		const values = {
			...rest,
			...(clientSecret !== undefined
				? { clientSecret: clientSecret ? encryptValue(clientSecret) : null }
				: {}),
			updatedAt: new Date(),
		};

		const existing = await findRow();
		const [row] = existing
			? await db
					.update(oidcSsoConfig)
					.set(values)
					.where(eq(oidcSsoConfig.id, existing.id))
					.returning()
			: await db.insert(oidcSsoConfig).values(values).returning();

		if (!row) {
			throw new Error("SSO configuration could not be saved");
		}
		return toStoredConfig(row);
	},
};
