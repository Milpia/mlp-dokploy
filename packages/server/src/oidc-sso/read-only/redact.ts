import { parse } from "dotenv";
import type { ReadOnlySets } from "../member-profile/cache";
import { REDACTED_VALUE } from "../types";
import { ENV_FIELDS, SECRET_FIELDS } from "./secret-fields";

const SERVICE_KEYS = [
	"applicationId",
	"composeId",
	"postgresId",
	"mysqlId",
	"mariadbId",
	"mongoId",
	"redisId",
	"libsqlId",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

// Parsed with the same dotenv Dokploy uses at deploy time, so a multi-line
// quoted value (a PEM key, a JSON credential) never leaks a line: only the
// variable names come back.
const maskEnv = (text: string) =>
	Object.keys(parse(text))
		.map((name) => `${name}=${REDACTED_VALUE}`)
		.join("\n");

const stringAt = (obj: Record<string, unknown>, key: string) =>
	typeof obj[key] === "string" ? (obj[key] as string) : null;

// An object with its own environment or service id decides for itself; a
// project row by its project; anything else inherits its parent.
const ownsReadOnly = (
	obj: Record<string, unknown>,
	scope: ReadOnlySets,
	inherited: boolean,
) => {
	const environmentId = stringAt(obj, "environmentId");
	if (environmentId) return scope.environmentIds.has(environmentId);
	const serviceIds = SERVICE_KEYS.map((key) => stringAt(obj, key)).filter(
		(id): id is string => id !== null,
	);
	if (serviceIds.length > 0) {
		return serviceIds.some((id) => scope.serviceIds.has(id));
	}
	const projectId = stringAt(obj, "projectId");
	if (projectId && "env" in obj) return scope.projectIds.has(projectId);
	return inherited;
};

const walk = (
	value: unknown,
	scope: ReadOnlySets,
	inherited: boolean,
): unknown => {
	if (Array.isArray(value)) {
		return value.map((item) => walk(item, scope, inherited));
	}
	if (!isPlainObject(value)) return value;
	const owned = ownsReadOnly(value, scope, inherited);
	const out: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(value)) {
		if (owned && ENV_FIELDS.has(key) && typeof field === "string") {
			out[key] = maskEnv(field);
		} else if (owned && SECRET_FIELDS.has(key) && field != null) {
			out[key] = REDACTED_VALUE;
		} else {
			out[key] = walk(field, scope, owned);
		}
	}
	return out;
};

/**
 * Masks the secrets of every object that belongs to the read-only scope,
 * object by object, so one response can show staging values and hide
 * production ones (spec 006, FR-006, research R6). Returns a copy.
 */
export const redact = (data: unknown, scope: ReadOnlySets): unknown =>
	walk(data, scope, false);
