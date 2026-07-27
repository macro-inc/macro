import { toast } from '@core/component/Toast/Toast';
import { authKeys } from '@queries/auth/keys';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import {
  fetchImportState,
  type ImportEntity,
  useRunImportMutation,
} from '@queries/import';
import { useCompleteOnboardingMutation } from '@queries/onboarding';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { type SkippedSources, stagedSelection } from './selection';

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

/**
 * The "leave /setup" workflow, as a composable primitive: derives the
 * current selection, and `finish()` imports it (holding while rows land),
 * completes onboarding + the legacy tutorial, and navigates into the app —
 * to the deep link the redirect preserved (`?next=`), or home.
 *
 * `skippedSources` is read reactively (pass the store proxy itself).
 */
export function createSetupFinish(options: {
  entities: Accessor<ImportEntity[] | undefined>;
  skippedSources: SkippedSources;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const completeOnboarding = useCompleteOnboardingMutation();
  const completeTutorial = useCompleteTutorialMutation();
  const runImport = useRunImportMutation();
  const [finishing, setFinishing] = createSignal(false);

  const selection = createMemo(() =>
    stagedSelection(options.entities(), options.skippedSources)
  );
  const selectedCount = createMemo(() => selection().importIds.length);

  // Where to land after setup. Same-app relative paths only.
  const afterSetupTarget = () => {
    const next = searchParams.next;
    return typeof next === 'string' &&
      next.startsWith('/') &&
      !next.startsWith('//')
      ? next
      : '/';
  };

  /**
   * Import the current selection and hold until the rows settle (the pills
   * animate importing → "in Macro" live while this waits). Returns how many
   * accepted items had NOT landed as imported when the wait ended — failed
   * rows fall back to `staged` with an error, and a capped wait counts the
   * stragglers too.
   */
  const runSelectedImports = async (): Promise<number> => {
    const { importIds, discardIds } = selection();
    if (importIds.length === 0 && discardIds.length === 0) return 0;
    await runImport.mutateAsync({ importIds, discardIds });
    if (importIds.length === 0) return 0;

    const accepted = new Set(importIds);
    const deadline = Date.now() + FINISH_IMPORT_WAIT_MS;
    while (Date.now() < deadline) {
      // Through the shared cache, so concurrent subscribers stay in sync;
      // a single failed poll is not fatal (the next tick retries).
      const entities = await fetchImportState().then(
        (state) => state.entities,
        () => undefined
      );
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

  // Import whatever is still selected (holding while the pills land), then
  // mark the flow completed server-side (which removes leftover
  // onboarding-staged candidates) and the legacy tutorial done (suppressing
  // the old modal), then land in the app.
  const finish = async (skipped: boolean) => {
    if (finishing()) return;
    setFinishing(true);
    try {
      if (!skipped) {
        // A hard failure here means the import request never took: don't
        // complete onboarding over the user's dropped selection. (A settle
        // timeout is different — runSelectedImports resolves 0 for it and
        // the imports keep landing server-side.)
        try {
          const failed = await runSelectedImports();
          if (failed > 0) {
            toast.failure(`${failed} items failed to import`);
          }
        } catch {
          toast.failure('Importing failed — please try again');
          return;
        }
      }
      await Promise.allSettled([
        completeOnboarding.mutateAsync({ skipped }),
        completeTutorial.mutateAsync(),
      ]);
      // NewOnboardingRedirect keys off userInfo.tutorialComplete: navigating
      // before the cache reflects the PATCH would bounce straight back here.
      // Refetch and verify — if the PATCH failed (allSettled hides it) or
      // the refetch missed, stay put and let the user retry.
      await queryClient
        .refetchQueries({ queryKey: authKeys.userInfo.queryKey })
        .catch(() => {});
      if (userInfoQuery.data?.tutorialComplete !== true) {
        toast.failure("Couldn't finish setup — please try again");
        return;
      }
      navigate(afterSetupTarget(), { replace: true });
    } finally {
      setFinishing(false);
    }
  };

  return { finishing, finish, selectedCount, afterSetupTarget };
}
