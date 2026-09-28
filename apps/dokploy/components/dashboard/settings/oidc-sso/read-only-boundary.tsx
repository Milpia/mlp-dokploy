import type { ComponentProps, ReactNode } from "react";
import { AlertBlock } from "@/components/shared/alert-block";
import { TabsContent } from "@/components/ui/tabs";
import { api } from "@/utils/api";
import { isReadOnlyService } from "./member-profile-view";

/**
 * Wraps the tabs of a service page that change things (spec 006, FR-010,
 * research R10). For a read-only service it explains why and renders the
 * content inside a disabled fieldset, which disables every native button,
 * input and menu trigger in it; the server refuses the changes anyway.
 */
export const ReadOnlyBoundary = ({
	serviceId,
	children,
}: {
	serviceId: string;
	children: ReactNode;
}) => {
	const { data } = api.oidcSso.memberProfileStatus.useQuery(undefined, {
		retry: false,
	});
	if (!isReadOnlyService(data, serviceId)) return <>{children}</>;
	return (
		<div className="flex flex-col gap-4">
			<AlertBlock type="info">
				Read-only: you can view this service, its logs and deployments, but not
				change it.
			</AlertBlock>
			<fieldset disabled className="m-0 min-w-0 border-0 p-0">
				{children}
			</fieldset>
		</div>
	);
};

/**
 * Drop-in for TabsContent on the tabs of a service page that change things,
 * so mounting it in an upstream page only changes the opening and closing
 * tags.
 */
export const ReadOnlyTabsContent = ({
	serviceId,
	children,
	...props
}: ComponentProps<typeof TabsContent> & { serviceId: string }) => (
	<TabsContent {...props}>
		<ReadOnlyBoundary serviceId={serviceId}>{children}</ReadOnlyBoundary>
	</TabsContent>
);
