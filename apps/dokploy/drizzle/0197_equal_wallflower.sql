CREATE TABLE "oidc_sso_login_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"groups" text[] NOT NULL,
	"last_sso_login_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oidc_sso_auth_event" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "oidc_sso_auth_event" ADD COLUMN "target_user_id" text;--> statement-breakpoint
ALTER TABLE "oidc_sso_config" ADD COLUMN "user_management_group" text;--> statement-breakpoint
ALTER TABLE "oidc_sso_login_state" ADD CONSTRAINT "oidc_sso_login_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;