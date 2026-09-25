import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const keycloakSsoConfig = pgTable("keycloak_sso_config", {
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
	buttonLabel: text("button_label").notNull().default("Sign in with Keycloak"),
	allowInsecureHttp: boolean("allow_insecure_http").notNull().default(false),
	verifiedIssuer: text("verified_issuer"),
	verifiedAt: timestamp("verified_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const keycloakAuthEvent = pgTable(
	"keycloak_auth_event",
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
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("keycloakAuthEvent_createdAt_idx").on(t.createdAt)],
);
