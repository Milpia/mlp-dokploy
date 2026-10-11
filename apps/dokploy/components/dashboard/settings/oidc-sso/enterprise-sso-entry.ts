const ENTERPRISE_SSO_URL = "/dashboard/settings/sso";

// With a valid enterprise license upstream's SSO prevails (spec 001,
// Assumptions), so its entry stays whatever the variable says.
export const withoutEnterpriseSsoEntry = <Item>(
	items: Item[],
	opts: { hide?: boolean; haveValidLicense?: boolean },
): Item[] =>
	opts.hide && !opts.haveValidLicense
		? items.filter(
				(item) => (item as { url?: string }).url !== ENTERPRISE_SSO_URL,
			)
		: items;
