import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import type { Model } from '@core/component/AI/types';

// import GoogleLogo from '@phosphor-icons/core/bold/google-logo-bold.svg?component-solid';
// import OpenAiLogoIcon from '@phosphor-icons/core/regular/open-ai-logo.svg?component-solid';

export { Model, ModelEnum } from '@core/component/AI/types';
export { AllModels } from '@service-cognition/generated/schemas/model';

type ExhaustiveMap = {
  [K in Model]: any;
};

export const MODEL_DESCRIPTION: ExhaustiveMap = {
  'anthropic/claude-sonnet-4': 'The best general purpose model from Anthropic',
} as const;

export const MODEL_PRETTYNAME: ExhaustiveMap = {
  'anthropic/claude-sonnet-4': 'Claude Sonnet 4',
} as const;

export const MODEL_PROVIDER_ICON: ExhaustiveMap = {
  'anthropic/claude-sonnet-4': AnthropicIcon,
};

export const DEFAULT_MODEL: Model = 'anthropic/claude-sonnet-4';
