export interface ProviderPreset {
	id: string;
	label: string;
	issuerPlaceholder: string;
	groupsClaim: string;
	extraScopes: string;
	/** What to configure on the provider so Dokploy receives the groups. */
	groupsHint: string;
}

export const DEFAULT_PRESET: ProviderPreset = {
	id: "keycloak",
	label: "Keycloak",
	issuerPlaceholder: "https://keycloak.example.com/realms/<realm>",
	groupsClaim: "groups",
	extraScopes: "",
	groupsHint:
		'Add a "Group Membership" mapper (token claim name: groups) to the client, or a default "groups" client scope. Plain names and full paths both work.',
};

/**
 * Presets only prefill fields (FR-024); every value stays editable, and
 * "generic" covers any other standards-compliant OIDC provider.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
	DEFAULT_PRESET,
	{
		id: "okta",
		label: "Okta",
		issuerPlaceholder: "https://<org>.okta.com/oauth2/default",
		groupsClaim: "groups",
		extraScopes: "groups",
		groupsHint:
			'In the authorization server, add a "groups" claim to the ID token (for example, filter "Matches regex .*"), and allow the groups scope.',
	},
	{
		id: "authentik",
		label: "Authentik",
		issuerPlaceholder: "https://authentik.example.com/application/o/<slug>/",
		groupsClaim: "groups",
		extraScopes: "",
		groupsHint:
			'Use an OAuth2/OpenID provider with the default profile scope mapping, which includes the user\'s groups in the "groups" claim.',
	},
	{
		id: "zitadel",
		label: "Zitadel",
		issuerPlaceholder: "https://<instance>.zitadel.cloud",
		groupsClaim: "urn:zitadel:iam:org:project:roles",
		extraScopes: "urn:zitadel:iam:org:projects:roles",
		groupsHint:
			'Zitadel sends project roles instead of groups: enable "Assert Roles on Authentication" on the project and use role keys as the access and admin groups.',
	},
	{
		id: "authelia",
		label: "Authelia",
		issuerPlaceholder: "https://auth.example.com",
		groupsClaim: "groups",
		extraScopes: "groups",
		groupsHint:
			'Allow the groups scope on the client. Authelia has no logout endpoint: in SSO-only mode, signing out shows a "signed out" screen instead of ending the Authelia session.',
	},
	{
		id: "generic",
		label: "Other (generic OIDC)",
		issuerPlaceholder: "https://idp.example.com",
		groupsClaim: "groups",
		extraScopes: "",
		groupsHint:
			"Any OpenID Connect provider with discovery works. Set the claim that carries groups or roles, and any scope needed to receive it.",
	},
];
