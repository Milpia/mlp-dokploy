import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ssoSignInUrl } from "@/lib/oidc-sso";

interface Props {
	label: string;
	returnTo?: string;
}

export const SignInWithSso = ({ label, returnTo }: Props) => {
	const [isRedirecting, setIsRedirecting] = useState(false);

	return (
		<Button
			variant="outline"
			className="w-full"
			type="button"
			isLoading={isRedirecting}
			onClick={() => {
				setIsRedirecting(true);
				// A full navigation is required: the server answers with a redirect
				// to the identity provider and sets the login transaction cookie.
				window.location.assign(ssoSignInUrl(returnTo));
			}}
		>
			<KeyRound className="size-4" />
			{label}
		</Button>
	);
};
