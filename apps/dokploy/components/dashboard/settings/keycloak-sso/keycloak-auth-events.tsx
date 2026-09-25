import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const TYPE_LABELS: Record<string, string> = {
	sso_login: "Keycloak sign-in",
	emergency_login: "Emergency sign-in",
	config_change: "Configuration change",
	mode_change: "Mode change",
};

const outcomeVariant = (outcome: string) =>
	outcome === "success" ? "blue" : "red";

export const KeycloakAuthEvents = () => {
	const { data: events, isPending } = api.keycloakSso.listEvents.useQuery({
		limit: 50,
	});

	return (
		<Card className="h-full bg-sidebar p-2.5 rounded-xl w-full">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="text-xl flex flex-row gap-2">
						<History className="size-6 text-muted-foreground self-center" />
						Recent authentication events
					</CardTitle>
					<CardDescription>
						Last 50 Keycloak sign-ins, emergency sign-ins and configuration
						changes. Events are kept for 90 days.
					</CardDescription>
				</CardHeader>
				<CardContent className="py-6 border-t">
					{isPending ? (
						<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[10vh]">
							<span>Loading...</span>
							<Loader2 className="animate-spin size-4" />
						</div>
					) : !events || events.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-6">
							No events yet.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>When</TableHead>
									<TableHead>Event</TableHead>
									<TableHead>Result</TableHead>
									<TableHead>Detail</TableHead>
									<TableHead>User</TableHead>
									<TableHead>Reference</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{events.map((event) => (
									<TableRow key={event.id}>
										<TableCell className="whitespace-nowrap">
											{new Date(event.createdAt).toLocaleString()}
										</TableCell>
										<TableCell>
											{TYPE_LABELS[event.type] ?? event.type}
										</TableCell>
										<TableCell>
											<Badge variant={outcomeVariant(event.outcome)}>
												{event.outcome}
											</Badge>
										</TableCell>
										<TableCell className="font-mono text-xs">
											{event.reason ?? ""}
										</TableCell>
										<TableCell>{event.email ?? ""}</TableCell>
										<TableCell className="font-mono text-xs">
											{event.correlationId}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</div>
		</Card>
	);
};
