import { db } from "@dokploy/server/db";
import {
	backups,
	deployments,
	domains,
	mounts,
	patch,
	ports,
	previewDeployments,
	redirects,
	rollbacks,
	schedules,
	security,
	volumeBackups,
} from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import type { SubResource } from "./policy";

/** Finds the service a sub-resource belongs to (spec 006, research R5). */
export interface SubResourceOwner {
	ownerOf(resource: SubResource, id: string): Promise<string | null>;
}

const first = (row: object | undefined, keys: string[]) => {
	for (const key of keys) {
		const value = (row as Record<string, unknown> | undefined)?.[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
};

const SERVICE_COLUMNS = [
	"applicationId",
	"composeId",
	"postgresId",
	"mysqlId",
	"mariadbId",
	"mongoId",
	"redisId",
	"libsqlId",
];

// A row owned by nothing (a server schedule, a web server backup, a mount
// with every service id null) resolves to null, and the guard denies;
// upstream skips its own check in that case.
export const drizzleSubResourceOwner: SubResourceOwner = {
	async ownerOf(resource, id) {
		switch (resource) {
			case "domain": {
				const row = await db.query.domains.findFirst({
					where: eq(domains.domainId, id),
					columns: {
						applicationId: true,
						composeId: true,
						previewDeploymentId: true,
					},
				});
				if (row?.previewDeploymentId && !row.applicationId && !row.composeId) {
					return this.ownerOf("previewDeployment", row.previewDeploymentId);
				}
				return first(row, ["applicationId", "composeId"]);
			}
			case "mount":
				return first(
					await db.query.mounts.findFirst({
						where: eq(mounts.mountId, id),
					}),
					SERVICE_COLUMNS,
				);
			case "port":
				return first(
					await db.query.ports.findFirst({ where: eq(ports.portId, id) }),
					["applicationId"],
				);
			case "redirect":
				return first(
					await db.query.redirects.findFirst({
						where: eq(redirects.redirectId, id),
					}),
					["applicationId"],
				);
			case "security":
				return first(
					await db.query.security.findFirst({
						where: eq(security.securityId, id),
					}),
					["applicationId"],
				);
			case "backup":
				return first(
					await db.query.backups.findFirst({
						where: eq(backups.backupId, id),
					}),
					SERVICE_COLUMNS,
				);
			case "volumeBackup":
				return first(
					await db.query.volumeBackups.findFirst({
						where: eq(volumeBackups.volumeBackupId, id),
					}),
					SERVICE_COLUMNS,
				);
			case "schedule":
				return first(
					await db.query.schedules.findFirst({
						where: eq(schedules.scheduleId, id),
					}),
					["applicationId", "composeId"],
				);
			case "previewDeployment":
				return first(
					await db.query.previewDeployments.findFirst({
						where: eq(previewDeployments.previewDeploymentId, id),
					}),
					["applicationId"],
				);
			case "patch":
				return first(
					await db.query.patch.findFirst({ where: eq(patch.patchId, id) }),
					["applicationId", "composeId"],
				);
			case "rollback": {
				const row = await db.query.rollbacks.findFirst({
					where: eq(rollbacks.rollbackId, id),
					columns: { deploymentId: true },
				});
				return row?.deploymentId
					? this.ownerOf("deployment", row.deploymentId)
					: null;
			}
			case "deployment": {
				const row = await db.query.deployments.findFirst({
					where: eq(deployments.deploymentId, id),
					columns: {
						applicationId: true,
						composeId: true,
						previewDeploymentId: true,
						scheduleId: true,
						backupId: true,
						volumeBackupId: true,
					},
				});
				const direct = first(row, ["applicationId", "composeId"]);
				if (direct || !row) return direct;
				if (row.previewDeploymentId) {
					return this.ownerOf("previewDeployment", row.previewDeploymentId);
				}
				if (row.scheduleId) return this.ownerOf("schedule", row.scheduleId);
				if (row.backupId) return this.ownerOf("backup", row.backupId);
				if (row.volumeBackupId) {
					return this.ownerOf("volumeBackup", row.volumeBackupId);
				}
				return null;
			}
		}
	},
};
