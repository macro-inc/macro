import { PERMISSION_IDS } from '@core/constant/permissions';
import { useHasPermission } from '@core/context/user';
import type { UnifiedNotification } from '@notifications/types';
import { type Accessor, createMemo } from 'solid-js';
import {
  buildRecommendationPrompt,
  pickRecommendations,
  recommendationSchema,
  triageableNotifications,
} from './homeRecommendations';
import { createAIProjection } from './projection';

// `provider/model` id routed by the projection generator. Must stay in the
// backend's free-tier allowlist (ai_projections FREE_TIER_MODELS). The smart
// projection omits the model and uses the server default (the smart tier).
const FAST_MODEL = 'anthropic/claude-haiku-4-5';

/**
 * Fast + smart recommendation projections. The static prompt instructs the
 * agent to gather the current user's notifications through ListNotifications;
 * the client notification accessor gates generation and validates returned ids.
 *
 * Two projections share one prompt and schema and differ only in model: the
 * fast one (Haiku, free tier) generates inline for immediate paint; the smart
 * one (server default, premium-gated) replaces it when it lands, and is
 * skipped entirely for users without professional features.
 *
 * All reference validation and view selection logic is pure and lives in
 * `homeRecommendations.ts`; this hook only wires it to the projections.
 */
export function createHomeRecommendations(args: {
  notifications: Accessor<readonly UnifiedNotification[]>;
  enabled?: Accessor<boolean>;
}) {
  const relevant = createMemo(() =>
    triageableNotifications(args.notifications())
  );
  const enabled = () => (args.enabled?.() ?? true) && relevant().length > 0;

  const isPremium = useHasPermission(PERMISSION_IDS.READ_PROFESSIONAL_FEATURES);
  const smartEnabled = () => enabled() && isPremium();

  const fast = createAIProjection(() => ({
    id: 'home/recommended-fast',
    prompt: buildRecommendationPrompt(),
    schema: recommendationSchema,
    model: FAST_MODEL,
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

  const items = createMemo(() =>
    pickRecommendations(smart.data(), fast.data(), relevant())
  );

  const retry = async () => {
    if (!enabled()) return;
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
    isLoading: () =>
      enabled() &&
      items() === undefined &&
      (fast.isGenerating() || smart.isGenerating()),
    /** Every enabled projection failed and there is nothing to show. */
    hasError: () =>
      items() === undefined &&
      fast.error() !== undefined &&
      (!smartEnabled() || smart.error() !== undefined),
    retry,
  };
}
