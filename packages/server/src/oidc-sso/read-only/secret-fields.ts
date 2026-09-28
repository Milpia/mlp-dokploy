/** Variables in `.env` form: names stay visible, values are masked (spec 006, FR-006). */
export const ENV_FIELDS: ReadonlySet<string> = new Set([
	"env",
	"previewEnv",
	"buildArgs",
	"previewBuildArgs",
	"buildSecrets",
	"previewBuildSecrets",
]);

/**
 * Fields masked whole in read-only environments (FR-006, research R6).
 * `content` is a mounted file or a patch, `composeFile` a whole compose and
 * `command` a custom command: any of them can hold a credential.
 */
export const SECRET_FIELDS: ReadonlySet<string> = new Set([
	"databasePassword",
	"databaseRootPassword",
	"password",
	"refreshToken",
	"content",
	"composeFile",
	"command",
]);

/**
 * Columns whose name looks secret but are not, checked by the drift test so
 * a new upstream column is always classified (research R6).
 */
export const NOT_SECRET_FIELDS: ReadonlySet<string> = new Set([
	"environmentId",
	"customGitSSHKeyId",
	"createEnvFile",
	"includeEncryptionKey",
]);
