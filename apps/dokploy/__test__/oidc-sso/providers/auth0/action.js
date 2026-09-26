/**
 * Post-Login Action for the spec 004 battery: Auth0 has no groups claim, so
 * the user's roles go into a namespaced claim on the ID token.
 */
/**
 * @param {{ authorization?: { roles?: string[] } }} event
 * @param {{ idToken: { setCustomClaim(name: string, value: unknown): void } }} api
 */
exports.onExecutePostLogin = async (event, api) => {
	api.idToken.setCustomClaim(
		"https://dokploy/groups",
		event.authorization?.roles ?? [],
	);
};
