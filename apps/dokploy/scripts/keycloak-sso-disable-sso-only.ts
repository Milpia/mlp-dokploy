import { getKeycloakSsoServices } from "@dokploy/server/keycloak-sso";
import { disableSsoOnlyCommand } from "@dokploy/server/keycloak-sso/admin/disable-sso-only";

(async () => {
	const { exitCode, lines } = await disableSsoOnlyCommand(
		getKeycloakSsoServices(),
	);
	for (const line of lines) {
		console.log(line);
	}
	process.exit(exitCode);
})();
