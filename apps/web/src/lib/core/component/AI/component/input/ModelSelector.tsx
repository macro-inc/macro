import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  Model,
  PAID_MODELS,
} from '@core/component/AI/constant';
import type { TModel } from '@core/component/AI/types';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { cn } from '@ui';
import { ModelCatalogPicker } from './ModelCatalogPicker';

/** A model and whether the current user may select it. */
export type ModelOption = { id: TModel; available: boolean };

type ModelSelectorProps = {
  selectedModel?: TModel;
  /** Per-model availability. Defaults to all models available. */
  models?: ModelOption[];
  onSelect: (model: TModel) => void;
  /** Called when an unavailable model is clicked (e.g. to open the paywall). */
  onLocked?: (model: TModel) => void;
  /** Collapse the trigger to just the provider icon (narrow inputs). */
  compact?: boolean;
};

const ALL_AVAILABLE: ModelOption[] = PAID_MODELS.map((id) => ({
  id,
  available: true,
}));

const MODEL_DESCRIPTION: Record<TModel, string> = {
  [Model.sonnet55]: 'Everyday writing, coding, and questions',
  [Model.opus55]: 'Complex tasks and deeper analysis',
  [Model.haiku45]: 'Quick answers and lighter tasks',
  [Model.gpt6Astra]: 'Frontier reasoning for the hardest problems',
  [Model.gpt61Sol]: 'Balanced reasoning, coding, and speed',
  [Model.gpt56]: 'Reasoning, writing, and problem solving',
  [Model.gpt56Mini]: 'Fast help with everyday tasks',
  [Model.gemini38Flash]: 'Fast answers over data and documents',
};

const isModel = (id: string): id is TModel =>
  PAID_MODELS.some((model) => model === id);

/** Chat's model selector: the shared catalog over the chat-routable models. */
export function ModelSelector(props: ModelSelectorProps) {
  const model = () => props.selectedModel ?? DEFAULT_MODEL;
  const options = () =>
    (props.models && props.models.length > 0
      ? props.models
      : ALL_AVAILABLE
    ).map((option) => ({
      id: option.id,
      label: MODEL_PRETTYNAME[option.id],
      description: MODEL_DESCRIPTION[option.id],
      locked: !option.available,
    }));

  return (
    <ModelCatalogPicker
      value={model()}
      options={options()}
      onSelect={(id) => {
        if (isModel(id)) props.onSelect(id);
      }}
      onLocked={(id) => {
        if (isModel(id)) props.onLocked?.(id);
      }}
      compact={props.compact || isMobile()}
      ariaLabel={`Choose model, ${MODEL_PRETTYNAME[model()]}`}
      placement="top-end"
      triggerClass={cn(
        'h-8 w-auto gap-1.5 border-0 px-2 text-sm text-ink-subtle hover:bg-hover',
        'not-touch:h-[33.75px] not-touch:text-base not-touch:gap-[5.625px] not-touch:px-[7.5px] not-touch:light-mode:text-composer-placeholder not-touch:light-mode:font-normal',
        props.compact && 'not-touch:p-[3.75px]',
        isMobile() &&
          'touch:min-h-11 touch:min-w-11 justify-center rounded-full',
        isMobile() && !virtualKeyboardVisible() && 'hidden'
      )}
    />
  );
}
