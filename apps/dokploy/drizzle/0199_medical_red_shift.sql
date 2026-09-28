ALTER TABLE "oidc_sso_auth_event" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "oidc_sso_member_profile" ADD COLUMN "read_only_environment_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_sso_member_profile" ADD COLUMN "read_only_service_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_sso_member_profile" ADD COLUMN "read_only_project_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL;