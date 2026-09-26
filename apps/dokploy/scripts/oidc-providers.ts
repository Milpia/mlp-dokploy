import {
	defaultRunnerDeps,
	runProviders,
} from "../__test__/oidc-sso/providers/runner";

(async () => {
	process.exit(await runProviders(process.argv[2], defaultRunnerDeps()));
})();
