import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { startSsoLogin } from '@core/auth/sso';
import { isTauri } from '@core/util/platform';
import IconGoogle from '@macro-icons/macro-google.svg';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import { cn } from '@ui';
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

    const success = await startSsoLogin({
      returnPath: `${ROUTER_BASE_CONCAT}welcome?google=1`,
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
      'outline-none focus:border-edge',
      hasError ? 'border-failure' : 'border-edge-muted'
    );

  return (
    <div class="flex flex-col gap-8 w-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Create your workspace
        </h1>
        <p class="text-sm text-ink-muted">
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
        <button
          type="button"
          onClick={handleGoogleAuth}
          disabled={authPending()}
          class="w-full flex items-center justify-center gap-2.5 h-9 text-sm font-medium rounded-sm border border-edge-muted bg-transparent text-ink hover:bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed outline-none focus:border-edge"
        >
          <IconGoogle />
          {authPending() ? 'Redirecting...' : 'Continue with Google'}
        </button>

        <div class="flex items-center gap-3 text-xs text-ink-extra-muted">
          <div class="h-px flex-1 bg-edge-muted" />
          or
          <div class="h-px flex-1 bg-edge-muted" />
        </div>

        <button
          type="button"
          onClick={handleContinueWithEmail}
          class="group w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-sm bg-accent text-surface border border-accent hover:bg-accent/90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Continue with email
          <ArrowRightIcon class="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <p class="text-xs text-ink-extra-muted text-center">
        By continuing, you agree to our{' '}
        <a
          class="underline hover:text-ink-muted transition-colors"
          href="/terms"
        >
          terms
        </a>{' '}
        and{' '}
        <a
          class="underline hover:text-ink-muted transition-colors"
          href="/privacy"
        >
          privacy policy
        </a>
        .
      </p>
    </div>
  );
}
