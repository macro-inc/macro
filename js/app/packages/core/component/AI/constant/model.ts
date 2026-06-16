import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import OpenAiIcon from '@core/component/AI/assets/openai.svg';

/**
 * Frontend-owned set of model ids. These are the provider api ids the backend
 * expects as plain strings — the backend `AgentModel` enum is intentionally not
 * exposed to the frontend. Reference these constants instead of hardcoding
 * strings.
 */
export const Model = {
  opus48: 'claude-opus-4-8',
  haiku45: 'claude-haiku-4-5',
  opus47: 'claude-opus-4-7',
  sonnet46: 'claude-sonnet-4-6',
  gpt55: 'gpt-5.5',
  gpt5Mini: 'gpt-5-mini',
} as const;

// `Model` is both a value (the const above) and a type (the union of api ids).
export type Model = (typeof Model)[keyof typeof Model];
/** Alias kept for existing call sites. */
export type TModel = Model;

type ExhaustiveMap = {
  [K in TModel]: any;
};

export const MODEL_PRETTYNAME: ExhaustiveMap = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5-mini': 'GPT-5 mini',
} as const;

export const MODEL_PROVIDER_ICON: ExhaustiveMap = {
  'claude-opus-4-8': AnthropicIcon,
  'claude-haiku-4-5': AnthropicIcon,
  'claude-opus-4-7': AnthropicIcon,
  'claude-sonnet-4-6': AnthropicIcon,
  'gpt-5.5': OpenAiIcon,
  'gpt-5-mini': OpenAiIcon,
};

export const DEFAULT_MODEL: TModel = Model.opus48;
