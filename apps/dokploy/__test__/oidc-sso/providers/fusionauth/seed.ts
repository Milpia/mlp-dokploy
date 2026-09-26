import { api, BASE } from "./driver";

/**
 * Kickstart runs in the background after start-up: wait until it created the
 * last user, then set the tenant issuer (FusionAuth defaults to a placeholder).
 */
export const seed = async () => {
	const deadline = Date.now() + 5 * 60_000;
	while (Date.now() < deadline) {
		const ready = await api("/api/user?username=manager")
			.then(() => true)
			.catch(() => false);
		if (ready) break;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	if (Date.now() >= deadline) {
		throw new Error("FusionAuth kickstart did not finish within 5 minutes");
	}
	const { tenants } = (await api("/api/tenant")) as {
		tenants: { id: string }[];
	};
	for (const tenant of tenants) {
		await api(`/api/tenant/${tenant.id}`, {
			method: "PATCH",
			body: JSON.stringify({ tenant: { issuer: BASE } }),
		});
	}
	// The tenant cache refreshes asynchronously; discovery must show the change.
	while (Date.now() < deadline) {
		const document = (await fetch(`${BASE}/.well-known/openid-configuration`)
			.then((response) => response.json())
			.catch(() => null)) as { issuer?: string } | null;
		if (document?.issuer === BASE) return;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error("FusionAuth discovery still shows the placeholder issuer");
};
