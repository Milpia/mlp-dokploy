import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Copy, KeyRound, Loader2, PlugZap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, type RouterOutputs } from "@/utils/api";
import { DEFAULT_PRESET, PROVIDER_PRESETS } from "./provider-presets";
import { SsoAuthEvents } from "./sso-auth-events";

type ConfigView = RouterOutputs["oidcSso"]["get"];
type Field = keyof ConfigView["sources"];

const schema = z.object({
	mode: z.enum(["disabled", "button", "sso-only"]),
	issuerUrl: z.string().trim().max(512),
	clientId: z.string().trim().max(512),
	clientSecret: z.string().max(1024),
	accessGroup: z.string().trim().max(512),
	adminGroup: z.string().trim().max(512),
	userManagementGroup: z.string().trim().max(512),
	groupsClaim: z.string().trim().max(256),
	extraScopes: z.string().trim().max(1024),
	buttonLabel: z.string().trim().min(1, "Required").max(64),
	allowInsecureHttp: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const INACTIVE_REASONS: Record<string, string> = {
	disabled: "Single sign-on is disabled.",
	incomplete:
		"The configuration is incomplete: issuer URL, client ID and client secret are required.",
	enterprise:
		"An enterprise license is active; the enterprise SSO takes precedence and this integration is off.",
	cloud: "Single sign-on (OIDC) is only available on self-hosted instances.",
};

const toFormValues = (view: ConfigView): FormValues => ({
	mode: view.mode,
	issuerUrl: view.issuerUrl ?? "",
	clientId: view.clientId ?? "",
	clientSecret: "",
	accessGroup: view.accessGroup ?? "",
	adminGroup: view.adminGroup ?? "",
	userManagementGroup: view.userManagementGroup ?? "",
	groupsClaim: view.groupsClaim,
	extraScopes: view.extraScopes,
	buttonLabel: view.buttonLabel,
	allowInsecureHttp: view.allowInsecureHttp,
});

const EnvBadge = ({ show }: { show: boolean }) =>
	show ? (
		<Badge variant="outline" className="ml-2 text-xs font-normal">
			from environment
		</Badge>
	) : null;

export const OidcSsoSettings = () => {
	const utils = api.useUtils();
	const { data: view, isPending } = api.oidcSso.get.useQuery();
	const { mutateAsync: update, isPending: isSaving } =
		api.oidcSso.update.useMutation();
	const { mutateAsync: testConnection, isPending: isTesting } =
		api.oidcSso.testConnection.useMutation();
	const [callbackUrl, setCallbackUrl] = useState("");
	const [presetId, setPresetId] = useState("keycloak");
	const preset =
		PROVIDER_PRESETS.find((candidate) => candidate.id === presetId) ??
		DEFAULT_PRESET;

	const form = useForm<FormValues>({
		resolver: zodResolver(schema),
		defaultValues: view ? toFormValues(view) : undefined,
	});

	useEffect(() => {
		if (view) form.reset(toFormValues(view));
	}, [view, form]);

	useEffect(() => {
		setCallbackUrl(`${window.location.origin}/api/auth/oidc/callback`);
	}, []);

	const fromEnv = useMemo(
		() => (field: Field) => view?.sources[field] === "env",
		[view],
	);

	const issuerUrl = form.watch("issuerUrl");
	const allowInsecureHttp = form.watch("allowInsecureHttp");
	const adminGroup = form.watch("adminGroup");

	if (isPending || !view) {
		return (
			<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
				<span>Loading...</span>
				<Loader2 className="animate-spin size-4" />
			</div>
		);
	}

	const editable = (field: Field) => !fromEnv(field);

	const onSubmit = async (values: FormValues) => {
		const payload: Record<string, unknown> = {};
		const fields: Field[] = [
			"mode",
			"issuerUrl",
			"clientId",
			"accessGroup",
			"adminGroup",
			"userManagementGroup",
			"groupsClaim",
			"extraScopes",
			"buttonLabel",
			"allowInsecureHttp",
		];
		for (const field of fields) {
			if (editable(field)) payload[field] = values[field];
		}
		if (editable("clientSecret") && values.clientSecret) {
			payload.clientSecret = values.clientSecret;
		}
		try {
			await update(payload);
			await utils.oidcSso.invalidate();
			toast.success("Single sign-on settings saved");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not save the settings",
			);
		}
	};

	const onTest = async () => {
		const values = form.getValues();
		const result = await testConnection({
			issuerUrl: values.issuerUrl || null,
			clientId: values.clientId || null,
			...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
			allowInsecureHttp: values.allowInsecureHttp,
		}).catch(() => null);
		if (!result) {
			toast.error("The connection test could not run");
		} else if (result.ok) {
			toast.success(`Connected to ${result.issuer}`);
		} else {
			toast.error(result.message);
		}
	};

	return (
		<div className="w-full flex flex-col gap-4">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl w-full">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<KeyRound className="size-6 text-muted-foreground self-center" />
							Single sign-on (OIDC)
						</CardTitle>
						<CardDescription>
							Let your team sign in with your identity provider (Keycloak, Okta,
							Authentik, Zitadel, Authelia or any OpenID Connect provider),
							either with a button on the login page or as the only way in.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 py-6 border-t">
						{view.active ? (
							<AlertBlock type="success">
								Single sign-on is active in{" "}
								<strong>
									{view.effectiveMode === "sso-only" ? "SSO-only" : "button"}
								</strong>{" "}
								mode.
							</AlertBlock>
						) : (
							<AlertBlock type="info">
								{INACTIVE_REASONS[view.inactiveReason ?? "disabled"]}
							</AlertBlock>
						)}
						{view.mode === "sso-only" && view.effectiveMode !== "sso-only" && (
							<AlertBlock type="warning">
								SSO-only is requested but the issuer has not been verified, so
								the login page still shows the local form. Sign in once through
								the identity provider using the owner account to verify it.
							</AlertBlock>
						)}
						{view.envErrors.map((message) => (
							<AlertBlock key={message} type="error">
								{message}
							</AlertBlock>
						))}

						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium">Provider</span>
							<Select
								value={presetId}
								onValueChange={(id) => {
									setPresetId(id);
									const next = PROVIDER_PRESETS.find((p) => p.id === id);
									if (!next) return;
									if (editable("groupsClaim")) {
										form.setValue("groupsClaim", next.groupsClaim, {
											shouldDirty: true,
										});
									}
									if (editable("extraScopes")) {
										form.setValue("extraScopes", next.extraScopes, {
											shouldDirty: true,
										});
									}
								}}
							>
								<SelectTrigger className="md:w-80">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_PRESETS.map((option) => (
										<SelectItem key={option.id} value={option.id}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<span className="text-xs text-muted-foreground">
								Presets fill the groups claim and extra scopes; every field
								stays editable.
							</span>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium">Redirect URI</span>
							<div className="flex gap-2">
								<Input readOnly value={callbackUrl} className="font-mono" />
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label="Copy redirect URI"
									onClick={async () => {
										await navigator.clipboard.writeText(callbackUrl);
										toast.success("Redirect URI copied");
									}}
								>
									<Copy className="size-4" />
								</Button>
							</div>
							<span className="text-xs text-muted-foreground">
								Register it as the exact redirect URI of the client in your
								identity provider. {preset.groupsHint}
							</span>
						</div>

						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="grid grid-cols-1 md:grid-cols-2 gap-4"
							>
								<FormField
									control={form.control}
									name="issuerUrl"
									render={({ field }) => (
										<FormItem className="md:col-span-2">
											<FormLabel>
												Issuer URL
												<EnvBadge show={fromEnv("issuerUrl")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder={preset.issuerPlaceholder}
													disabled={!editable("issuerUrl")}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="clientId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Client ID
												<EnvBadge show={fromEnv("clientId")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="dokploy"
													disabled={!editable("clientId")}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="clientSecret"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Client secret
												<EnvBadge show={fromEnv("clientSecret")} />
											</FormLabel>
											<FormControl>
												<Input
													type="password"
													autoComplete="new-password"
													placeholder={
														view.hasClientSecret
															? "Stored — leave empty to keep it"
															: "Client secret"
													}
													disabled={!editable("clientSecret")}
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="accessGroup"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Access group
												<EnvBadge show={fromEnv("accessGroup")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="dokploy-users"
													disabled={!editable("accessGroup")}
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Members get an account on first sign-in. Separate
												several groups with commas. Leave empty to only allow
												existing users.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="adminGroup"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Admin group
												<EnvBadge show={fromEnv("adminGroup")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="dokploy-admins"
													disabled={!editable("adminGroup")}
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Members become admins; everyone else becomes a member.
												Separate several groups with commas. Leave empty to
												manage roles in Dokploy.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								{adminGroup && (
									<AlertBlock type="warning" className="md:col-span-2">
										Roles are recalculated on every single sign-on: role changes
										made in Dokploy for these users are overwritten. The owner
										is never changed.
									</AlertBlock>
								)}
								<FormField
									control={form.control}
									name="userManagementGroup"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												User management group
												<EnvBadge show={fromEnv("userManagementGroup")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="admins"
													disabled={!editable("userManagementGroup")}
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Only the owner and members of this group can manage
												users. Leave empty to keep Dokploy&apos;s default rules.
												Requires an SSO login in the last 8 hours.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="groupsClaim"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Groups claim
												<EnvBadge show={fromEnv("groupsClaim")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="groups"
													disabled={!editable("groupsClaim")}
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Claim with the user's groups or roles: a list, a single
												value or an object keyed by role (Zitadel).
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="extraScopes"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Extra scopes
												<EnvBadge show={fromEnv("extraScopes")} />
											</FormLabel>
											<FormControl>
												<Input
													placeholder="groups"
													disabled={!editable("extraScopes")}
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Requested in addition to openid email profile, separated
												by spaces.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="buttonLabel"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Button label
												<EnvBadge show={fromEnv("buttonLabel")} />
											</FormLabel>
											<FormControl>
												<Input disabled={!editable("buttonLabel")} {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="mode"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												Mode
												<EnvBadge show={fromEnv("mode")} />
											</FormLabel>
											<Select
												onValueChange={field.onChange}
												value={field.value}
												disabled={!editable("mode")}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="disabled">Disabled</SelectItem>
													<SelectItem value="button">
														Button on the login page
													</SelectItem>
													<SelectItem
														value="sso-only"
														disabled={
															!view.verified && view.mode !== "sso-only"
														}
													>
														SSO-only (redirect to the identity provider)
													</SelectItem>
												</SelectContent>
											</Select>
											<FormDescription>
												{view.verified
													? "SSO-only is available: the issuer was verified by an owner sign-in."
													: "SSO-only unlocks after you sign in once through the identity provider using the owner account."}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="allowInsecureHttp"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 md:col-span-2">
											<div className="space-y-0.5">
												<FormLabel>
													Allow insecure HTTP
													<EnvBadge show={fromEnv("allowInsecureHttp")} />
												</FormLabel>
												<FormDescription>
													Only for local development. A production identity
													provider must use HTTPS.
												</FormDescription>
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
													disabled={!editable("allowInsecureHttp")}
												/>
											</FormControl>
										</FormItem>
									)}
								/>
								<p className="text-sm text-muted-foreground md:col-span-2">
									Emergency origin:{" "}
									{view.emergencyOrigin ? (
										<>
											<span className="font-mono">{view.emergencyOrigin}</span>{" "}
											(set by environment). While SSO-only is active, the owner
											can use the emergency sign-in from this origin.
										</>
									) : (
										"Not set"
									)}
								</p>
								{allowInsecureHttp && issuerUrl.startsWith("http:") && (
									<AlertBlock type="warning" className="md:col-span-2">
										Plain HTTP is allowed: credentials and tokens travel
										unencrypted between Dokploy and the identity provider.
									</AlertBlock>
								)}
								<div className="flex w-full justify-end gap-2 md:col-span-2">
									<Button
										type="button"
										variant="outline"
										onClick={onTest}
										isLoading={isTesting}
									>
										<PlugZap className="size-4" />
										Test connection
									</Button>
									<Button type="submit" isLoading={isSaving}>
										Save
									</Button>
								</div>
							</form>
						</Form>
					</CardContent>
				</div>
			</Card>
			<SsoAuthEvents />
		</div>
	);
};
