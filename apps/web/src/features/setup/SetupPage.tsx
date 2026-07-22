import { toast } from '@core/component/Toast/Toast';
import LogoIcon from '@icon/macro-logo.svg';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useImportQuery, useRunImportMutation } from '@queries/import';
import {
  useCompleteOnboardingMutation,
  useOnboardingQuery,
} from '@queries/onboarding';
import { importClient } from '@service-cognition/import';
import { useNavigate } from '@solidjs/router';
import { Button, Layer } from '@ui';
import { createEffect, createSignal, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ConnectorsSection } from './ConnectorsSection';
import { ImportPanel, stagedSelection } from './ImportPanel';

/**
 * The split-screen onboarding page (`/setup`): connect tools on the left,
 * pick what to bring over on the right. Everything is orchestrated
 * server-side — reads of an active onboarding start due gather runs,
 * connector OAuth completions hook in instantly, and `POST /import/run`
 * copies accepted items in — so this page only renders state and decides
 * when the user is done.
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

/**
 * How long "Continue to Macro" holds for in-flight imports before letting
 * the user through anyway (imports keep landing server-side; the ledger is
 * never lost to navigation).
 */
const FINISH_IMPORT_WAIT_MS = 90_000;
const FINISH_POLL_INTERVAL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function SetupPageContent() {
  const navigate = useNavigate();
  const userInfoQuery = useUserInfoQuery();
  const completeOnboarding = useCompleteOnboardingMutation();
  const completeTutorial = useCompleteTutorialMutation();
  const onboardingQuery = useOnboardingQuery();
  const importQuery = useImportQuery();
  const runImport = useRunImportMutation();

  // Deselection set for staged pills (pills start selected; clicking
  // toggles). Lives here so the footer's "Continue to Macro" imports the
  // same selection the per-section actions do. Keyed by row id so
  // re-gathers and refetches keep the user's picks.
  const [deselected, setDeselected] = createStore<Record<string, boolean>>({});

  // Redirect out when there is nothing to set up (unauthenticated, or the
  // flow was already completed elsewhere).
  createEffect(() => {
    if (userInfoQuery.data?.authenticated === false) {
      navigate('/login', { replace: true });
      return;
    }
    if (onboardingQuery.data?.row.status === 'completed') {
      navigate('/', { replace: true });
    }
  });

  /**
   * Import the current selection and hold until the rows settle (the pills
   * animate importing → "in Macro" live while this waits). Returns how many
   * accepted items had NOT landed as imported when the wait ended — failed
   * rows fall back to `staged` with an error, and a capped wait counts the
   * stragglers too.
   */
  const runSelectedImports = async (): Promise<number> => {
    const { importIds, discardIds } = stagedSelection(
      importQuery.data?.entities,
      deselected
    );
    if (importIds.length === 0 && discardIds.length === 0) return 0;
    await runImport.mutateAsync({ importIds, discardIds });
    if (importIds.length === 0) return 0;

    const accepted = new Set(importIds);
    const deadline = Date.now() + FINISH_IMPORT_WAIT_MS;
    while (Date.now() < deadline) {
      const state = await importClient.getState();
      const entities = state.isOk() ? state.value.entities : undefined;
      if (entities) {
        const inFlight = entities.some(
          (entity) => accepted.has(entity.id) && entity.status === 'importing'
        );
        if (!inFlight) {
          return entities.filter(
            (entity) => accepted.has(entity.id) && entity.status !== 'imported'
          ).length;
        }
      }
      await sleep(FINISH_POLL_INTERVAL_MS);
    }
    return 0; // Timed out waiting — imports continue server-side.
  };

  // Finishing: import whatever is still selected (holding while the pills
  // land), then mark the flow completed server-side (which discards leftover
  // onboarding-staged candidates) and the legacy tutorial done (suppressing
  // the old modal), then land in the app.
  const [finishing, setFinishing] = createSignal(false);
  const finish = async (skipped: boolean) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      if (!skipped) {
        const failed = await runSelectedImports().catch(() => 0);
        if (failed > 0) {
          toast.failure(`${failed} items failed to import`);
        }
      }
      await Promise.allSettled([
        completeOnboarding.mutateAsync({ skipped }),
        completeTutorial.mutateAsync(),
      ]);
    } finally {
      navigate('/', { replace: true });
    }
  };

  const selectedCount = () =>
    stagedSelection(importQuery.data?.entities, deselected).importIds.length;

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
              Connect your work — Macro builds your workspace around it.
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
            disabled={finishing()}
            onClick={() => void finish(false)}
          >
            {finishing()
              ? 'Setting up your workspace…'
              : selectedCount() > 0
                ? `Import ${selectedCount()} & continue`
                : 'Continue to Macro'}
          </Button>
          <button
            type="button"
            class="text-xs text-ink-extra-muted transition-colors hover:text-ink-muted"
            disabled={finishing()}
            onClick={() => void finish(true)}
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
            <ImportPanel deselected={deselected} onToggle={setDeselected} />
          </div>
        </Layer>
      </div>
    </div>
  );
}
