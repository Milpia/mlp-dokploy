import { validateRequest } from "@dokploy/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { SignInWithSso } from "@/components/auth/sign-in-with-sso";
import { userManagementVisibility } from "@/components/dashboard/settings/oidc-sso/user-management-visibility";
import { ShowInvitations } from "@/components/dashboard/settings/users/show-invitations";
import { ShowUsers } from "@/components/dashboard/settings/users/show-users";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { ManageCustomRoles } from "@/components/proprietary/roles/manage-custom-roles";
import { AlertBlock } from "@/components/shared/alert-block";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";

const Page = () => {
	const { data: auth } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const isOwnerOrAdmin = auth?.role === "owner" || auth?.role === "admin";
	const { data: userManagement } = api.oidcSso.userManagementStatus.useQuery();
	const { canInvite, canManageRoles, showExpiredNotice } =
		userManagementVisibility(
			{
				canInvite: permissions?.member.create ?? false,
				canManageRoles: isOwnerOrAdmin,
			},
			userManagement,
		);

	return (
		<div className="flex flex-col gap-4 w-full">
			{showExpiredNotice && (
				<div className="w-full max-w-5xl mx-auto">
					<AlertBlock type="warning">
						<div className="flex flex-col gap-3">
							<span>
								Your permission to manage users expired. Sign in with SSO again.
							</span>
							<div className="max-w-xs">
								<SignInWithSso
									label="Sign in with SSO"
									returnTo="/dashboard/settings/users"
								/>
							</div>
						</div>
					</AlertBlock>
				</div>
			)}
			<ShowUsers />
			{canInvite && <ShowInvitations />}
			{canManageRoles && <ManageCustomRoles />}
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Users">{page}</DashboardLayout>;
};
export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	const { req, res } = ctx;
	const { user, session } = await validateRequest(req);

	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	try {
		await helpers.user.get.prefetch();
		await helpers.settings.isCloud.prefetch();

		const userPermissions = await helpers.user.getPermissions.fetch();

		if (!userPermissions?.member.read) {
			return {
				redirect: {
					permanent: false,
					destination: "/",
				},
			};
		}

		return {
			props: {
				trpcState: helpers.dehydrate(),
			},
		};
	} catch {
		return {
			props: {},
		};
	}
}
