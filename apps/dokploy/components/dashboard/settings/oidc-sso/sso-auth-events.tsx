import { History, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";
import { authEventView, eventPagination } from "./auth-event-view";

const PAGE_SIZE = 20;

const outcomeVariant = (outcome: string) =>
	outcome === "success" ? "blue" : "red";

const EventsTable = () => {
	const [page, setPage] = useState(1);
	const { data, isPending, isFetching } = api.oidcSso.listEvents.useQuery(
		{ page, pageSize: PAGE_SIZE },
		{ placeholderData: (previous) => previous },
	);

	if (isPending) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[20vh]">
				<span>Loading...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	if (!data || data.total === 0) {
		return (
			<p className="text-sm text-muted-foreground text-center py-10">
				No events yet.
			</p>
		);
	}

	const pages = eventPagination(data.total, data.page, data.pageSize);

	return (
		<div className="flex flex-col gap-4 min-w-0">
			<div className="overflow-x-auto rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>When</TableHead>
							<TableHead>Event</TableHead>
							<TableHead>Result</TableHead>
							<TableHead>Detail</TableHead>
							<TableHead>User</TableHead>
							<TableHead>Action</TableHead>
							<TableHead>Affected user</TableHead>
							<TableHead>Reference</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.items.map((event) => {
							const view = authEventView(event);
							return (
								<TableRow key={event.id}>
									<TableCell className="whitespace-nowrap">
										{new Date(event.createdAt).toLocaleString()}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{view.type}
										{event.emergencyOrigin && (
											<Badge variant="outline" className="ml-2">
												via emergency origin
											</Badge>
										)}
									</TableCell>
									<TableCell>
										<Badge variant={outcomeVariant(event.outcome)}>
											{event.outcome}
										</Badge>
									</TableCell>
									<TableCell className="font-mono text-xs">
										{event.reason ?? ""}
									</TableCell>
									<TableCell>{view.who}</TableCell>
									<TableCell className="whitespace-nowrap">
										{view.action}
									</TableCell>
									<TableCell>{view.target}</TableCell>
									<TableCell className="font-mono text-xs">
										{event.correlationId}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm text-muted-foreground tabular-nums">
					{pages.from}–{pages.to} of {data.total} · page {data.page} of{" "}
					{pages.pageCount}
				</span>
				<div className="flex items-center gap-2">
					{isFetching && (
						<Loader2 className="animate-spin size-4 text-muted-foreground" />
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage(data.page - 1)}
						disabled={!pages.canPrevious || isFetching}
					>
						Previous
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPage(data.page + 1)}
						disabled={!pages.canNext || isFetching}
					>
						Next
					</Button>
				</div>
			</div>
		</div>
	);
};

export const SsoAuthEventsDialog = () => (
	<Dialog>
		<DialogTrigger asChild>
			<Button variant="outline" size="sm">
				<History className="size-4" />
				Authentication events
			</Button>
		</DialogTrigger>
		<DialogContent className="sm:max-w-6xl max-h-[85vh] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>Authentication events</DialogTitle>
				<DialogDescription>
					SSO sign-ins, emergency sign-ins, configuration changes and denied
					user-management attempts, newest first. Events are kept for 90 days.
				</DialogDescription>
			</DialogHeader>
			<EventsTable />
		</DialogContent>
	</Dialog>
);
