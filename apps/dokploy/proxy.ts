import { type NextRequest, NextResponse } from "next/server";
import { dashboardLoginRedirect } from "@/lib/dashboard-return-to";

export function proxy(request: NextRequest) {
	const target = dashboardLoginRedirect(
		request.nextUrl,
		request.headers.get("cookie"),
	);
	return target ? NextResponse.redirect(target) : NextResponse.next();
}

export const config = {
	matcher: ["/dashboard", "/dashboard/:path*"],
};
