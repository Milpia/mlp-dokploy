CREATE TABLE IF NOT EXISTS "oidc_sso_member_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"groups" text[] NOT NULL,
	"applied_at" timestamp NOT NULL,
	"expired_at" timestamp,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oidc_sso_config" ADD COLUMN IF NOT EXISTS "group_profiles" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oidc_sso_member_profile" ADD CONSTRAINT "oidc_sso_member_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oidc_sso_member_profile" ADD CONSTRAINT "oidc_sso_member_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;