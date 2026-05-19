import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { useIsAuthenticated } from '@core/auth';
import { startSsoLogin } from '@core/auth/sso';
import { toast } from '@core/component/Toast/Toast';
import { isTauri } from '@core/util/platform';
import IconGoogle from '@icon/macro-google.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Button, cn } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { z } from 'zod';
import { useOnboarding } from '../onboarding-context';

const NAME_MAX_LENGTH = 50;
const TEAM_NAME_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 254;

const profileSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(NAME_MAX_LENGTH, 'First name is too long'),
  lastName: z.string().max(NAME_MAX_LENGTH, 'Last name is too long'),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(EMAIL_MAX_LENGTH, 'Email is too long'),
  teamName: z
    .string()
    .min(1, 'Team name is required')
    .max(TEAM_NAME_MAX_LENGTH, 'Team name is too long'),
});

export function ProfileStep() {
  const ctx = useOnboarding();
  const isAuthenticated = useIsAuthenticated();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [authPending, setAuthPending] = createSignal(false);

  let firstNameRef: HTMLInputElement | undefined;
  onMount(() => firstNameRef?.focus());

  const validate = () => {
    const result = profileSchema.safeParse({
      firstName: ctx.firstName().trim(),
      lastName: ctx.lastName().trim(),
      email: ctx.email().trim(),
      teamName: ctx.teamName().trim(),
    });

    if (result.success) {
      setErrors({});
      return true;
    }

    const errs: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !errs[field]) {
        errs[field] = issue.message;
      }
    }
    setErrors(errs);
    return false;
  };

  const clearError = (field: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleGoogleAuth = async () => {
    if (!validate()) return;
    setAuthPending(true);

    sessionStorage.setItem(
      'onboarding_profile',
      JSON.stringify({
        firstName: ctx.firstName(),
        lastName: ctx.lastName(),
        email: ctx.email(),
        teamName: ctx.teamName(),
      })
    );

    try {
      const success = await startSsoLogin({
        returnPath: `${ROUTER_BASE_CONCAT}welcome?google=1`,
        loginHint: ctx.email().trim() || undefined,
      });

      if (success) {
        if (isTauri()) {
          window.location.hash = '#/welcome?google=1';
          window.location.reload();
        } else {
          window.location.href = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?google=1`;
        }
      } else {
        setAuthPending(false);
      }
    } catch (e) {
      console.error('Google sign-in failed:', e);
      toast.failure('Sign-in failed. Please try again.');
      setAuthPending(false);
    }
  };

  const handleContinueWithEmail = () => {
    if (!validate()) return;
    ctx.next();
  };

  const handleContinueAuthed = () => {
    if (!validate()) return;
    ctx.skipStep('verify');
    ctx.next();
  };

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full px-2.5 h-9 text-sm rounded-sm border bg-transparent text-ink placeholder:text-ink-placeholder transition-colors',
      'outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface',
      hasError ? 'border-failure' : 'border-edge-muted'
    );

  return (
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          {isAuthenticated() ? 'Your workspace' : 'Create your workspace'}
        </h1>
        <p class="text-sm text-ink-disabled">
          {isAuthenticated()
            ? 'Confirm your details before continuing.'
            : 'Tell us about yourself and your team.'}
        </p>
      </div>

      <div class="flex flex-col gap-5">
        <div class="flex gap-3">
          <div class="flex-1 flex flex-col gap-2">
            <label for="onb-first-name" class="text-sm font-medium text-ink">
              First name
            </label>
            <input
              ref={firstNameRef}
              id="onb-first-name"
              type="text"
              maxLength={NAME_MAX_LENGTH}
              value={ctx.firstName()}
              onInput={(e) => {
                ctx.setFirstName(e.currentTarget.value);
                clearError('firstName');
              }}
              placeholder="Jane"
              class={inputClass(!!errors().firstName)}
            />
            <Show when={errors().firstName}>
              <p class="text-xs text-failure">{errors().firstName}</p>
            </Show>
          </div>
          <div class="flex-1 flex flex-col gap-2">
            <label for="onb-last-name" class="text-sm font-medium text-ink">
              Last name
            </label>
            <input
              id="onb-last-name"
              type="text"
              maxLength={NAME_MAX_LENGTH}
              value={ctx.lastName()}
              onInput={(e) => {
                ctx.setLastName(e.currentTarget.value);
                clearError('lastName');
              }}
              placeholder="Doe"
              class={inputClass(!!errors().lastName)}
            />
            <Show when={errors().lastName}>
              <p class="text-xs text-failure">{errors().lastName}</p>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label for="onb-email" class="text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="onb-email"
            type="email"
            maxLength={EMAIL_MAX_LENGTH}
            value={ctx.email()}
            onInput={(e) => {
              ctx.setEmail(e.currentTarget.value);
              clearError('email');
            }}
            placeholder="jane@company.com"
            class={inputClass(!!errors().email)}
          />
          <Show when={errors().email}>
            <p class="text-xs text-failure">{errors().email}</p>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <label for="onb-team-name" class="text-sm font-medium text-ink">
            Team name
          </label>
          <input
            id="onb-team-name"
            type="text"
            maxLength={TEAM_NAME_MAX_LENGTH}
            value={ctx.teamName()}
            onInput={(e) => {
              ctx.setTeamName(e.currentTarget.value);
              clearError('teamName');
            }}
            placeholder="Acme Inc."
            class={inputClass(!!errors().teamName)}
          />
          <Show when={errors().teamName}>
            <p class="text-xs text-failure">{errors().teamName}</p>
          </Show>
        </div>
      </div>

      <Show
        when={!isAuthenticated()}
        fallback={
          <Button
            variant="base"
            size="lg"
            onClick={handleContinueAuthed}
            class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            Continue
            <ArrowRightIcon class="size-4" />
          </Button>
        }
      >
        <div class="flex flex-col gap-3">
          <Button
            variant="base"
            size="lg"
            onClick={handleGoogleAuth}
            disabled={authPending()}
            class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface [&_svg]:size-6"
          >
            <IconGoogle />
            {authPending() ? 'Redirecting...' : 'Continue with Google'}
          </Button>

          <div class="flex items-center gap-3 text-xs text-ink-extra-muted">
            <div class="h-px flex-1 bg-edge-muted" />
            or
            <div class="h-px flex-1 bg-edge-muted" />
          </div>

          <Button
            variant="base"
            size="lg"
            onClick={handleContinueWithEmail}
            class="w-full focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            Continue with email
            <ArrowRightIcon class="size-4" />
          </Button>
        </div>
      </Show>
    </div>
  );
}
