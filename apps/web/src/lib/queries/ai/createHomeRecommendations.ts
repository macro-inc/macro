import { FREE_DEFAULT_MODEL } from '@core/component/AI/constant';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { useHasPermission } from '@core/context/user';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  buildRecommendationPrompt,
  pickRecommendations,
  recommendationSchema,
} from './homeRecommendations';
import { createAIProjection } from './projection';

/**
 * Fast + smart recommendation projections. The static prompt instructs the
 * agent to gather non-email items through ListNotifications and emails through
 * ListEntities, which preserves each entity type's canonical inbox semantics.
 *
 * Two projections share one prompt and schema and differ only in model: the
 * fast one (the free-tier model, available on every plan) generates inline for
 * immediate paint; the smart one (server default, premium-gated) replaces it
 * when it lands, and is skipped entirely for users without professional
 * features.
 *
 * Result selection is pure and lives in `homeRecommendations.ts`; this hook
 * only wires it to the projections.
 */
export function createHomeRecommendations(
  args: { enabled?: Accessor<boolean> } = {}
) {
  const enabled = () => args.enabled?.() ?? true;

  const isPremium = useHasPermission(PERMISSION_IDS.READ_PROFESSIONAL_FEATURES);
  const smartEnabled = () => enabled() && isPremium();

  const fast = createAIProjection(() => ({
    id: 'home/recommended-fast',
    prompt: buildRecommendationPrompt(),
    schema: recommendationSchema,
    model: FREE_DEFAULT_MODEL,
    awaitGeneration: true,
    refreshCadence: 'high',
    expiry: 'day',
    enabled: enabled(),
  }));

  const smart = createAIProjection(() => ({
    id: 'home/recommended-smart',
    prompt: buildRecommendationPrompt(),
    schema: recommendationSchema,
    refreshCadence: 'high',
    expiry: 'day',
    enabled: smartEnabled(),
  }));

  const items = () => pickRecommendations(smart.data(), fast.data());

  const [timedOut, setTimedOut] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  const waiting = createMemo(
    () =>
      enabled() &&
      items() === undefined &&
      (fast.isGenerating() || smart.isGenerating())
  );

  // Bound the visible loading state even if the server never leaves "loading".
  // Keep accepting a late result; cached items always take precedence.
  createEffect(
    on([waiting, attempt], ([pending]) => {
      setTimedOut(false);
      if (!pending) return;
      const timer = setTimeout(() => setTimedOut(true), 45_000);
      onCleanup(() => clearTimeout(timer));
    })
  );

  const canRetry = () => !fast.isForbidden();

  const retry = async () => {
    if (!enabled() || !canRetry()) return;
    setAttempt((value) => value + 1);
    const requests = [fast.refresh()];
    if (smartEnabled()) requests.push(smart.refresh());
    await Promise.allSettled(requests);
  };

  return {
    /** Best available items: smart when it has landed, else fast. */
    items,
    /** Smart pass still running — the visible items may improve shortly. */
    isThinking: () => smartEnabled() && smart.isGenerating(),
    /** Nothing to render yet. */
    isLoading: () => waiting() && !timedOut(),
    /** Generation failed or timed out, with no cached result to show. */
    hasError: () =>
      items() === undefined &&
      (timedOut() ||
        (fast.error() !== undefined &&
          (!smartEnabled() || smart.error() !== undefined))),
    /** False when the plan refused the request, so retrying would fail again. */
    canRetry,
    retry,
  };
}
