import { AlertBlock } from "@/components/shared/alert-block";
import { api } from "@/utils/api";

/**
 * Project names in the group profiles that match no project or more than one
 * (spec 005, research R5), and read-only environment names that match none
 * (spec 006, R8): a typo there would leave that environment writable. Saved
 * profiles only: the check runs on the effective configuration, not on
 * unsaved edits.
 */
export const GroupProfilesCheck = ({ enabled }: { enabled: boolean }) => {
	const { data } = api.oidcSso.groupProfilesCheck.useQuery(undefined, {
		enabled,
	});
	const issues = (data?.groups ?? []).filter(
		(group) =>
			group.missingProjects.length > 0 ||
			group.ambiguousProjects.length > 0 ||
			group.missingReadOnlyEnvironments.length > 0,
	);
	if (issues.length === 0) return null;
	return (
		<AlertBlock type="warning">
			<div className="flex flex-col gap-1">
				{issues.map((group) => (
					<span key={group.group}>
						<strong>{group.group}</strong>:{" "}
						{group.missingProjects.length > 0 &&
							`no project named ${group.missingProjects.join(", ")}. `}
						{group.ambiguousProjects.length > 0 &&
							`several projects named ${group.ambiguousProjects.join(", ")}; all of them are included. `}
						{group.missingReadOnlyEnvironments.length > 0 &&
							`no environment named ${group.missingReadOnlyEnvironments.join(", ")} to make read-only.`}
					</span>
				))}
			</div>
		</AlertBlock>
	);
};
