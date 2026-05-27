import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import type { TModel } from '@core/component/AI/types';

export { Model } from '@core/component/AI/types';

type ExhaustiveMap = {
  [K in TModel]: any;
};

export const MODEL_PRETTYNAME: ExhaustiveMap = {
  smart: 'Smart',
  fast: 'Fast',
  opus4_7: 'Opus 4.7',
  sonnet4_6: 'Sonnet 4.6',
  haiku4_5: 'Haiku 4.5',
  retired: 'Retired',
} as const;

export const MODEL_PROVIDER_ICON: ExhaustiveMap = {
  smart: AnthropicIcon,
  fast: AnthropicIcon,
  opus4_7: AnthropicIcon,
  sonnet4_6: AnthropicIcon,
  haiku4_5: AnthropicIcon,
  retired: AnthropicIcon,
};

export const DEFAULT_MODEL: TModel = 'smart';
