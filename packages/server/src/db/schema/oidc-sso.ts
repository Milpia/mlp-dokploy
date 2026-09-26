import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./user";

export const oidcSsoConfig = pgTable("oidc_sso_config", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	mode: text("mode", { enum: ["disabled", "button", "sso-only"] })
		.notNull()
		.default("disabled"),
	issuerUrl: text("issuer_url"),
	clientId: text("client_id"),
	// Encrypted with encryptValue (enc:v1:...), never returned by the API.
	clientSecret: text("client_secret"),
	accessGroup: text("access_group"),
	adminGroup: text("admin_group"),
	userManagementGroup: text("user_management_group"),
	groupsClaim: text("groups_claim").notNull().default("groups"),
	// Space-separated, appended to "openid email profile".
	extraScopes: text("extra_scopes").notNull().default(""),
	buttonLabel: text("button_label").notNull().default("Sign in with SSO"),
	allowInsecureHttp: boolean("allow_insecure_http").notNull().default(false),
	verifiedIssuer: text("verified_issuer"),
	verifiedAt: timestamp("verified_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const oidcSsoAuthEvent = pgTable(
	"oidc_sso_auth_event",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		type: text("type").notNull(),
		outcome: text("outcome").notNull(),
		reason: text("reason"),
		email: text("email"),
		// No foreign key: events must outlive the user they describe.
		userId: text("user_id"),
		ip: text("ip"),
		correlationId: text("correlation_id").notNull(),
		emergencyOrigin: boolean("emergency_origin").notNull().default(false),
		action: text("action"),
		// No foreign key, like userId: the event outlives the affected user.
		targetUserId: text("target_user_id"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("oidcSsoAuthEvent_createdAt_idx").on(t.createdAt)],
);

/** Groups seen at each user's last SSO login (spec 002, research R5). */
export const oidcSsoLoginState = pgTable("oidc_sso_login_state", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	groups: text("groups").array().notNull(),
	lastSsoLoginAt: timestamp("last_sso_login_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});
