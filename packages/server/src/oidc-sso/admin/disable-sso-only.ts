import { newCorrelationId } from "../events/auth-events";
import type { OidcSsoServices } from "../services";

export interface CommandResult {
	exitCode: 0 | 1 | 2;
	lines: string[];
}

const ENV_WARNING =
	"Warning: SSO_OIDC_MODE=sso-only is set in the environment; remove it and restart for the change to apply.";

/** Emergency command (FR-012a, FR-021; contracts/cli-and-env.md). */
export const disableSsoOnlyCommand = async (
	services: OidcSsoServices,
): Promise<CommandResult> => {
	let result: Awaited<ReturnType<typeof services.config.disableSsoOnlyMode>>;
	try {
		result = await services.config.disableSsoOnlyMode();
	} catch (error) {
		return {
			exitCode: 1,
			lines: [
				`Could not update the SSO configuration: ${
					error instanceof Error ? error.message : String(error)
				}`,
			],
		};
	}

	await services.events.record({
		type: "mode_change",
		outcome: "success",
		reason: result.changed
			? "emergency_command:sso-only->button"
			: "emergency_command:no_change",
		correlationId: newCorrelationId(),
	});

	const lines = [
		result.changed
			? "SSO-only mode disabled. The instance is now in button mode."
			: "SSO-only mode was not enabled. Nothing to do.",
	];
	if (result.forcedByEnv) {
		lines.push(ENV_WARNING);
		return { exitCode: 2, lines };
	}
	return { exitCode: 0, lines };
};
