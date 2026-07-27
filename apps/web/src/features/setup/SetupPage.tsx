import LogoIcon from '@icon/macro-logo.svg';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { usePrimaryEmailLinkId } from '@queries/email/link';
import { useImportQuery } from '@queries/import';
import { useOnboardingQuery } from '@queries/onboarding';
import { useNavigate } from '@solidjs/router';
import { Button, Layer } from '@ui';
import { createEffect, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ConnectorsSection } from './ConnectorsSection';
import { createSetupFinish } from './createSetupFinish';
import { ImportPanel } from './ImportPanel';
import type { SkippedSources } from './selection';

/**
 * The split-screen onboarding page (`/setup`): connect tools on the left,
 * pick what to bring over on the right. Everything is orchestrated
 * server-side — reads of an active onboarding start due gather runs,
 * connector OAuth completions hook in instantly, and `POST /import/run`
 * copies accepted items in — so this page only renders state and decides
 * when the user is done (the finish workflow lives in createSetupFinish).
 */
export function SetupPage() {
  // The page owns its Suspense boundary: /setup renders under the app's
  // root <Suspense>, so any query suspending here would otherwise blank the
  // ENTIRE app. The polling queries carry placeholderData so they can never
  // re-suspend; this boundary contains genuine first-load waits from the
  // rest (user info).
  return (
    <Suspense
      fallback={
        <div class="flex h-full w-full items-center justify-center bg-surface">
          <LogoIcon class="size-8 animate-pulse text-accent" />
        </div>
      }
    >
      <SetupPageContent />
    </Suspense>
  );
}

function SetupPageContent() {
  const navigate = useNavigate();
  const userInfoQuery = useUserInfoQuery();
  const onboardingQuery = useOnboardingQuery();
  const importQuery = useImportQuery();
  // The user's own primary inbox link — present once email is connected
  // (drives the welcome copy: inbox processing vs plain setup).
  const emailConnected = usePrimaryEmailLinkId();

  // Per-source skip set (sections import by default; each card's toggle
  // flips its whole source off). Lives here so the footer's "Continue to
  // Macro" imports exactly the sections still toggled on. Keyed by source
  // so re-gathers and refetches keep the user's picks.
  const [skippedSources, setSkippedSources] = createStore<SkippedSources>({});

  const setupFinish = createSetupFinish({
    entities: () => importQuery.data?.entities,
    skippedSources,
  });

  // Redirect out when there is nothing to set up (unauthenticated, or the
  // flow was already completed elsewhere).
  createEffect(() => {
    if (userInfoQuery.data?.authenticated === false) {
      navigate('/login', { replace: true });
      return;
    }
    if (onboardingQuery.data?.row.status === 'completed') {
      navigate(setupFinish.afterSetupTarget(), { replace: true });
    }
  });

  return (
    // Same chrome as fullscreen settings: the left rail sits directly on the
    // page surface and the right pane is the subtly-raised, bordered card in
    // a tight gutter.
    <div class="flex h-full w-full overflow-hidden bg-surface font-sans text-ink">
      {/* Left: connect your work */}
      <div class="flex w-[40%] min-w-[380px] max-w-[520px] flex-col">
        <div class="flex flex-1 flex-col overflow-y-auto">
          <header class="px-8 pt-12">
            <LogoIcon class="size-8 text-accent" />
            <h1 class="mt-6 text-2xl/tight font-semibold">Welcome to Macro</h1>
            <p class="mt-1.5 text-sm text-ink-muted">
              {emailConnected()
                ? "While we process your inbox, let's bring in your tasks, documents, contacts, and channels, and set up your team."
                : 'Set up Macro by bringing in your tasks, documents, and channels, then invite your team.'}
            </p>
          </header>

          <div class="flex flex-col gap-8 px-8 pb-8 pt-9">
            <ConnectorsSection />
          </div>
        </div>

        <footer class="flex items-center justify-between px-8 py-5">
          <Button
            variant="active"
            depth={3}
            disabled={setupFinish.finishing()}
            onClick={() => void setupFinish.finish(false)}
          >
            {setupFinish.finishing()
              ? 'Setting up your workspace…'
              : setupFinish.selectedCount() > 0
                ? `Import ${setupFinish.selectedCount()} & continue`
                : 'Continue to Macro'}
          </Button>
          <button
            type="button"
            class="text-xs text-ink-extra-muted transition-colors hover:text-ink-muted"
            disabled={setupFinish.finishing()}
            onClick={() => void setupFinish.finish(true)}
          >
            Set up later
          </button>
        </footer>
      </div>

      {/* Right: what to bring over, in the settings content card
          (Layer-raised, rounded, inner border). */}
      <div class="min-w-0 flex-1 py-2 pr-2 pl-0">
        <Layer depth={1}>
          <div class="relative flex size-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-surface shadow-menu">
            <ImportPanel
              skipped={skippedSources}
              onToggleSource={(source, skipped) =>
                setSkippedSources(source, skipped)
              }
            />
          </div>
        </Layer>
      </div>
    </div>
  );
}
