import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { startSsoLogin } from '@core/auth/sso';
import { isTauri } from '@core/util/platform';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import IconGoogle from '@macro-icons/macro-google.svg';
import { Button, cn } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

export function ProfileStep() {
  const ctx = useOnboarding();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [authPending, setAuthPending] = createSignal(false);

  let firstNameRef: HTMLInputElement | undefined;
  onMount(() => firstNameRef?.focus());

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!ctx.firstName().trim()) errs.firstName = 'First name is required';
    if (!ctx.email().trim()) {
      errs.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.email().trim())) {
      errs.email = 'Invalid email address';
    }
    if (!ctx.teamName().trim()) errs.teamName = 'Team name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
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
    }
  };

  const handleContinueWithEmail = () => {
    if (!validate()) return;
    ctx.next();
  };

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full px-2.5 h-9 text-sm rounded-sm border bg-transparent text-ink placeholder:text-ink-placeholder transition-colors',
      'outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface',
      hasError ? 'border-failure' : 'border-ink/10'
    );

  return (
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Create your workspace
        </h1>
        <p class="text-sm text-ink-disabled">
          Tell us about yourself and your team.
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
              value={ctx.lastName()}
              onInput={(e) => ctx.setLastName(e.currentTarget.value)}
              placeholder="Doe"
              class={inputClass(false)}
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label for="onb-email" class="text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="onb-email"
            type="email"
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
    </div>
  );
}
