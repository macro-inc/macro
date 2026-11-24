import { t } from '@app/lib/i18n';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import PinFill from '@icon/system/fill/push-pin-fill.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Pin from '@icon/system/regular/push-pin.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';

export function ModelSelectorModelRow(props: { onModels: () => void }) {
  const state = useUnifiedModelSelector();
  const model = () =>
    state.models.find((option) => option.id === state.model)?.label ??
    catalogModelLabel(state.model, state.models);
  const value = () => (
    <>
      <ModelIcon model={state.model} class="size-4 shrink-0" />
      <span class="min-w-0 truncate">{model()}</span>
    </>
  );
  return (
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center text-xs text-ink-extra-muted">
        <span>{t('agentControls.model')}</span>
        <Show
          when={state.model !== state.agent?.defaultModel && state.onKeepModel}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={state.disabled}
            aria-label={
              state.modelKept
                ? t('agentControls.stopKeepingModel', { model: model() })
                : t('agentControls.keepModel', {
                    model: model(),
                    agent: state.agent?.name ?? '',
                  })
            }
            aria-pressed={Boolean(state.modelKept)}
            onClick={() => state.onKeepModel?.(!state.modelKept)}
          >
            <Show when={state.modelKept} fallback={<Pin class="size-4" />}>
              <PinFill class="size-4 text-accent" />
            </Show>
          </Button>
        </Show>
      </div>
      <Show
        when={state.models.length > 1}
        fallback={
          <div class="flex min-w-0 items-center gap-2 text-xs">{value()}</div>
        }
      >
        <Button
          variant="ghost"
          size="xs"
          disabled={state.disabled}
          onClick={props.onModels}
          class="min-w-0"
        >
          {value()}
          <CaretRight class="size-4 shrink-0" />
        </Button>
      </Show>
    </div>
  );
}
