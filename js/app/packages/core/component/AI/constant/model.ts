import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import OpenAiIcon from '@core/component/AI/assets/openai.svg';

/**
 * Frontend-owned set of model ids. These are the `provider/model` ids the
 * backend router expects as plain strings (the provider segment is how routing
 * picks the provider) — the backend `AgentModel` enum is intentionally not
 * exposed to the frontend. Reference these constants instead of hardcoding
 * strings.
 */
export const Model = {
  opus48: 'anthropic/claude-opus-4-8',
  haiku45: 'anthropic/claude-haiku-4-5',
  sonnet46: 'anthropic/claude-sonnet-4-6',
  gpt55: 'openai/gpt-5.5',
  gpt5Mini: 'openai/gpt-5-mini',
} as const;

// `Model` is both a value (the const above) and a type (the union of api ids).
export type Model = (typeof Model)[keyof typeof Model];
/** Alias kept for existing call sites. */
export type TModel = Model;

type ExhaustiveMap = {
  [K in TModel]: any;
};

export const MODEL_PRETTYNAME: ExhaustiveMap = {
  'anthropic/claude-opus-4-8': 'Opus 4.8',
  'anthropic/claude-haiku-4-5': 'Haiku 4.5',
  'anthropic/claude-sonnet-4-6': 'Sonnet 4.6',
  'openai/gpt-5.5': 'GPT-5.5',
  'openai/gpt-5-mini': 'GPT-5 mini',
} as const;

export const MODEL_PROVIDER_ICON: ExhaustiveMap = {
  'anthropic/claude-opus-4-8': AnthropicIcon,
  'anthropic/claude-haiku-4-5': AnthropicIcon,
  'anthropic/claude-sonnet-4-6': AnthropicIcon,
  'openai/gpt-5.5': OpenAiIcon,
  'openai/gpt-5-mini': OpenAiIcon,
};

/** Default model for paid users. */
export const DEFAULT_MODEL: TModel = Model.opus48;

/**
 * Default model for free users. Free users aren't entitled to the premium
 * "smart" models (which the backend rejects with a 403), so they start on the
 * fast model instead of Opus.
 */
export const FREE_DEFAULT_MODEL: TModel = Model.haiku45;

/** Models a paid user may select — the full set. */
export const PAID_MODELS: readonly TModel[] = Object.values(Model);

/**
 * Models a free user may select. Free users only get the fast model
 * (`FREE_DEFAULT_MODEL`); every other model is paid-only and shows locked in
 * the selector, where selecting one opens the paywall instead of being sent
 * and rejected by the backend.
 */
export const FREE_MODELS: readonly TModel[] = [FREE_DEFAULT_MODEL];

/** The default model for a user given their paid entitlement. */
export function defaultModelForPlan(hasPaidAccess: boolean): TModel {
  return hasPaidAccess ? DEFAULT_MODEL : FREE_DEFAULT_MODEL;
}

/** The selectable models for a user given their paid entitlement. */
export function modelsForPlan(hasPaidAccess: boolean): readonly TModel[] {
  return hasPaidAccess ? PAID_MODELS : FREE_MODELS;
}
