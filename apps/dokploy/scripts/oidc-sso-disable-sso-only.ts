import { getOidcSsoServices } from "@dokploy/server/oidc-sso";
import { disableSsoOnlyCommand } from "@dokploy/server/oidc-sso/admin/disable-sso-only";

(async () => {
	const { exitCode, lines } = await disableSsoOnlyCommand(getOidcSsoServices());
	for (const line of lines) {
		console.log(line);
	}
	process.exit(exitCode);
})();
