import { GOOGLE_GMAIL_IDP } from '@core/auth/email';
import IconGoogle from '@icon/macro-google.svg';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { useSsoLogin } from '../useSsoLogin';

/**
 * Onboarding step 0 — create the account by connecting the primary Gmail via
 * SSO sign-in. There is no Continue button here: once the SSO flow completes
 * `useIsAuthenticated()` flips true and `MobileOnboarding` auto-advances to the
 * next step. The escape hatch creates an account without connecting email.
 */
export function OnboardingCreateAccount() {
  const navigate = useNavigate();
  const startSsoLogin = useSsoLogin({ signupMode: true });

  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-4">
        <h1 class="text-2xl font-semibold tracking-tight text-ink">
          Welcome to Macro
        </h1>
        <p class="text-sm/relaxed text-ink-muted">
          Connect a Gmail account to start syncing your emails, contacts, and
          attachments.
        </p>
        <p class="text-sm/relaxed text-ink-muted">
          This will be your primary email account that you will use to sign in
          to Macro.
        </p>
      </div>

      <div class="flex flex-col gap-2 pt-2">
        <Button
          variant="strong"
          size="xl"
          onClick={() => startSsoLogin(GOOGLE_GMAIL_IDP)}
        >
          <IconGoogle class="size-5" />
          Connect Gmail
        </Button>
        <button
          type="button"
          class="self-start pt-4 text-xs text-ink-muted/70 underline hover:text-ink/70"
          onClick={() => navigate('/signup')}
        >
          Create account without connecting email
        </button>
      </div>
    </div>
  );
}
