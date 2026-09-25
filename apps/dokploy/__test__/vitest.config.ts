import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__test__/**/*.test.ts"], // Incluir solo los archivos de test en el directorio __test__
		exclude: ["**/node_modules/**", "**/dist/**", "**/.docker/**"],
		pool: "forks",
		setupFiles: [path.resolve(__dirname, "setup.ts")],
		coverage: {
			provider: "v8",
			// Text only: an HTML report inside apps/dokploy is picked up by tsc.
			reporter: ["text"],
			allowExternal: true,
			include: [
				path.resolve(__dirname, "../../../packages/server/src/keycloak-sso/**"),
			],
			thresholds: {
				lines: 90,
				branches: 85,
			},
		},
	},
	define: {
		"process.env": {
			NODE: "test",
			GITHUB_CLIENT_ID: "test",
			GITHUB_CLIENT_SECRET: "test",
			GOOGLE_CLIENT_ID: "test",
			GOOGLE_CLIENT_SECRET: "test",
		},
	},
	plugins: [
		tsconfigPaths({
			projects: [path.resolve(__dirname, "../tsconfig.json")],
		}),
	],
	resolve: {
		alias: {
			"@dokploy/server": path.resolve(
				__dirname,
				"../../../packages/server/src",
			),
		},
	},
});
