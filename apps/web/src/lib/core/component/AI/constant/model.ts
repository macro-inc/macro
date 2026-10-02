import OpenAiIcon from '@core/component/AI/assets/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import GoogleIcon from '@phosphor-fill/google-logo-fill.svg';

/**
 * Frontend-owned set of model ids. These are the `provider/model` ids the
 * backend router expects as plain strings (the provider segment is how routing
 * picks the provider) — the backend `AgentModel` enum is intentionally not
 * exposed to the frontend. Reference these constants instead of hardcoding
 * strings.
 *
 * Only the current Anthropic generation is offered; retired Claude ids are
 * absent on purpose, so a persisted chat on one falls back to the default.
 */
export const Model = {
  sonnet55: 'anthropic/claude-sonnet-5-5',
  opus55: 'anthropic/claude-opus-5-5',
  gpt6Astra: 'openai/gpt-6-astra',
  gpt56: 'openai/gpt-5.6',
  gpt56Mini: 'openai/gpt-5.6-mini',
  gemini38Flash: 'google/gemini-3.8-flash',
} as const;

// `Model` is both a value (the const above) and a type (the union of api ids).
export type Model = (typeof Model)[keyof typeof Model];
/** Alias kept for existing call sites. */
export type TModel = Model;

type ExhaustiveMap = {
  [K in TModel]: any;
};

export const MODEL_PRETTYNAME: ExhaustiveMap = {
  'anthropic/claude-sonnet-5-5': 'Sonnet 5.5',
  'anthropic/claude-opus-5-5': 'Opus 5.5',
  'openai/gpt-6-astra': 'GPT-6 Astra',
  'openai/gpt-5.6': 'GPT-5.6',
  'openai/gpt-5.6-mini': 'GPT-5.6 mini',
  'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
} as const;

export const MODEL_PROVIDER_ICON: ExhaustiveMap = {
  'anthropic/claude-sonnet-5-5': ClaudeIcon,
  'anthropic/claude-opus-5-5': ClaudeIcon,
  'openai/gpt-6-astra': OpenAiIcon,
  'openai/gpt-5.6': OpenAiIcon,
  'openai/gpt-5.6-mini': OpenAiIcon,
  'google/gemini-3.8-flash': GoogleIcon,
};

/**
 * How fast each model draws down a paid plan's included AI, relative to the
 * default model (Sonnet 5.5 = 1). Mirrors the per-token rates in `ai_pricing`
 * (output price, which dominates chat cost): Sonnet $10, Opus $25, GPT-6
 * Astra $50, GPT-5.6 $30, GPT-5.6 mini $4.50, Gemini 3.8 Flash $3.75 per
 * million tokens. Shown in the picker so choosing a heavy model is a
 * deliberate trade.
 */
export const MODEL_USAGE_MULTIPLIER: { [K in TModel]: number } = {
  'anthropic/claude-sonnet-5-5': 1,
  'anthropic/claude-opus-5-5': 2.5,
  'openai/gpt-6-astra': 5,
  'openai/gpt-5.6': 3,
  'openai/gpt-5.6-mini': 0.45,
  'google/gemini-3.8-flash': 0.375,
};

/**
 * The picker's usage hint for a model: "2.5× usage" for models that burn the
 * allowance faster than the default, nothing for the default and cheaper.
 */
export function modelUsageHint(model: TModel): string | undefined {
  const multiplier = MODEL_USAGE_MULTIPLIER[model];
  if (multiplier <= 1) return undefined;
  return `${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}× usage`;
}

/** Default model for paid users. */
export const DEFAULT_MODEL: TModel = Model.sonnet55;

/**
 * Default model for free users. Free users aren't entitled to the premium
 * models (which the backend rejects with a 403), so they start on the
 * current Sonnet, the only model the free plan may use.
 */
export const FREE_DEFAULT_MODEL: TModel = Model.sonnet55;

/** Models a paid user may select. */
export const PAID_MODELS: readonly TModel[] = Object.values(Model);

/**
 * Model for database AI: question answering, the database assistant, and chats
 * opened from a database. Paid-only, like every model but {@link FREE_DEFAULT_MODEL}.
 */
export const DATABASE_MODEL: TModel = Model.gemini38Flash;

/**
 * Models a free user may select. Free users only get `FREE_DEFAULT_MODEL`;
 * every other model is paid-only and shows locked in the selector, where
 * selecting one opens the paywall instead of being sent and rejected by the
 * backend. The heavy models (Opus, GPT-6 Astra) are on every paid plan; they
 * just draw the included AI down faster, see `MODEL_USAGE_MULTIPLIER`.
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

/** {@link DATABASE_MODEL} when the plan includes it, else the plan's default. */
export function databaseModelForPlan(hasPaidAccess: boolean): TModel {
  return modelsForPlan(hasPaidAccess).includes(DATABASE_MODEL)
    ? DATABASE_MODEL
    : defaultModelForPlan(hasPaidAccess);
}

/** Provider serving each model — mirrors the backend `provider` field. */
export const MODEL_PROVIDER: ExhaustiveMap = {
  'anthropic/claude-sonnet-5-5': 'anthropic',
  'anthropic/claude-opus-5-5': 'anthropic',
  'openai/gpt-6-astra': 'openai',
  'openai/gpt-5.6': 'openai',
  'openai/gpt-5.6-mini': 'openai',
  'google/gemini-3.8-flash': 'google',
} as const;

/** Options for {@link alternateProviderModel}. */
export type AlternateProviderModelOptions = {
  /**
   * The user's available models (in display order). The suggestion is drawn
   * only from these so we never propose a model the user can't use. When
   * omitted/empty, the full static model list is used.
   */
  candidates?: readonly TModel[];
  /**
   * Providers known to be failing this session. The suggestion avoids all of
   * them — so once Anthropic *and* OpenAI have failed we stop bouncing the user
   * between them and return `undefined` instead.
   */
  failedProviders?: Iterable<string>;
};

/**
 * Pick a model from a provider other than `current`'s — and other than any
 * provider already known to be failing this session — for recovering from a
 * provider outage. Returns `undefined` when no accessible model on a healthy
 * provider remains.
 */
export function alternateProviderModel(
  current: TModel,
  options?: AlternateProviderModelOptions
): TModel | undefined {
  // Exclude the current provider (always switch *away* from it) plus every
  // provider that has already failed this session.
  const excluded = new Set<string>(options?.failedProviders ?? []);
  excluded.add(MODEL_PROVIDER[current]);

  const candidates = options?.candidates;
  const pool = candidates && candidates.length > 0 ? candidates : PAID_MODELS;
  return pool.find((id) => !excluded.has(MODEL_PROVIDER[id]));
}
