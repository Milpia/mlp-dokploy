const SESSION_COOKIE =
	/(?:^|;\s*)(?:__Secure-)?better-auth[.-]session_token=[^;]+/;

/**
 * Where a signed-out request to the dashboard should go so the login can
 * bring the user back afterwards (US2, deep links). Only cookie presence is
 * checked: validating the session stays with each page's getServerSideProps.
 */
export const dashboardLoginRedirect = (
	url: URL,
	cookieHeader: string | null,
): URL | null => {
	if (
		url.pathname !== "/dashboard" &&
		!url.pathname.startsWith("/dashboard/")
	) {
		return null;
	}
	if (cookieHeader && SESSION_COOKIE.test(cookieHeader)) return null;

	const target = new URL("/", url);
	target.searchParams.set("returnTo", `${url.pathname}${url.search}`);
	return target;
};
