export const DEFAULT_RETURN_TO = "/dashboard/home";

const MAX_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = "http://return-to.invalid";

const hasUnsafeCharacter = (value: string): boolean => {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f || value[i] === "\\") return true;
	}
	return false;
};

/**
 * Only same-origin paths survive (NFR-SEC-003). The value is checked both
 * raw and URL-decoded because browsers normalise "/%2F%2Fhost" and "/\host"
 * into protocol-relative URLs.
 */
export const sanitizeReturnTo = (
	value: unknown,
	fallback: string = DEFAULT_RETURN_TO,
): string => {
	if (typeof value !== "string" || !value || value.length > MAX_LENGTH) {
		return fallback;
	}

	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return fallback;
	}

	for (const candidate of [value, decoded]) {
		if (!candidate.startsWith("/")) return fallback;
		if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
			return fallback;
		}
		if (hasUnsafeCharacter(candidate)) return fallback;
	}

	let url: URL;
	try {
		url = new URL(value, PLACEHOLDER_ORIGIN);
	} catch {
		return fallback;
	}
	if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
	if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
		return fallback;
	}

	return `${url.pathname}${url.search}${url.hash}`;
};
