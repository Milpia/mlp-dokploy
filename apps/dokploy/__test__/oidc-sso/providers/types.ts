import type { Page } from "playwright-core";

export const PROVIDER_IDS = [
	"keycloak",
	"okta",
	"auth0",
	"authentik",
	"zitadel",
	"fusionauth",
	"authelia",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const SCENARIO_IDS = [
	"login-provisioning",
	"admin-role",
	"access-denied",
	"role-change",
	"sign-out",
	"connection-test-ok",
	"connection-test-bad",
	"user-management-group",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export type ScenarioOutcome =
	| "passed"
	| "failed"
	| "not-applicable"
	| "pending";

export interface VerificationResult {
	schema: "oidc-compat/v1";
	provider: ProviderId;
	/** e.g. "26.7.4"; SaaS: "saas" plus the run date. */
	providerVersion: string;
	moduleCommit: string;
	/** ISO 8601, UTC. */
	ranAt: string;
	environment: "local" | "ci";
	status: "passed" | "failed" | "skipped";
	skippedReason?: string;
	scenarios: Record<ScenarioId, ScenarioOutcome>;
	failures?: { scenario: ScenarioId; message: string }[];
}

export type TestUserRole = "member" | "admin" | "outsider" | "manager";

export interface TestUser {
	username: string;
	password: string;
	email: string;
}

/** What the owner would type into the SSO settings screen for this provider. */
export interface ModuleConfig {
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	groupsClaim: string;
	extraScopes: string;
	accessGroup: string;
	adminGroup: string;
	/** Spec 002: only the owner and this group manage users. */
	userManagementGroup: string;
	allowInsecureHttp: boolean;
}

export interface ProviderDriver {
	id: ProviderId;
	kind: "self-hosted" | "saas";
	/** Pinned image version, or "saas" for hosted tenants. */
	version: string;
	/** SaaS: variables without which the provider is skipped. */
	requiredEnv: string[];
	moduleConfig(): ModuleConfig | Promise<ModuleConfig>;
	users: Record<TestUserRole, TestUser>;
	/** For "role-change": put the user in exactly this group at the provider. */
	moveUser(role: TestUserRole, toGroup: string): Promise<void>;
	/** Completes the provider's sign-in in the browser. */
	login(page: Page, user: TestUser): Promise<void>;
}
