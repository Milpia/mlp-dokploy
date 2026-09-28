import { SignInWithSso } from "@/components/auth/sign-in-with-sso";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";
import {
	overwriteNotice,
	profileBadgeLabel,
	showExpiredNotice,
} from "./member-profile-view";

const useMemberProfiles = () =>
	api.oidcSso.memberProfiles.useQuery(undefined, { retry: false });

export const MemberProfileBadge = ({ userId }: { userId: string }) => {
	const { data } = useMemberProfiles();
	const label = profileBadgeLabel(data?.[userId]);
	return label ? (
		<Badge variant="outline" className="ml-2 font-normal">
			{label}
		</Badge>
	) : null;
};

export const MemberProfileOverwriteNotice = ({
	userId,
}: {
	userId: string;
}) => {
	const { data } = useMemberProfiles();
	const message = overwriteNotice(data?.[userId]);
	return message ? <AlertBlock type="warning">{message}</AlertBlock> : null;
};

export const MemberProfileExpiredNotice = ({
	returnTo,
}: {
	returnTo: string;
}) => {
	const { data } = api.oidcSso.memberProfileStatus.useQuery();
	if (!showExpiredNotice(data)) return null;
	return (
		<AlertBlock type="warning">
			<div className="flex flex-col gap-3">
				<span>
					Your access expired 8 hours after your last SSO sign-in. Sign in with
					SSO again to see your projects.
				</span>
				<div className="max-w-xs">
					<SignInWithSso label="Sign in with SSO" returnTo={returnTo} />
				</div>
			</div>
		</AlertBlock>
	);
};
