CREATE TABLE "oidc_sso_auth_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"email" text,
	"user_id" text,
	"ip" text,
	"correlation_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_sso_config" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'disabled' NOT NULL,
	"issuer_url" text,
	"client_id" text,
	"client_secret" text,
	"access_group" text,
	"admin_group" text,
	"groups_claim" text DEFAULT 'groups' NOT NULL,
	"button_label" text DEFAULT 'Sign in with SSO' NOT NULL,
	"allow_insecure_http" boolean DEFAULT false NOT NULL,
	"verified_issuer" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oidcSsoAuthEvent_createdAt_idx" ON "oidc_sso_auth_event" USING btree ("created_at");