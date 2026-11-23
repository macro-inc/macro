import { t } from '@app/lib/i18n';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import PinFill from '@icon/system/fill/push-pin-fill.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Pin from '@icon/system/regular/push-pin.svg';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';

export function ModelSelectorModelRow(props: {
  mobile?: boolean;
  onModels: () => void;
}) {
  const state = useUnifiedModelSelector();
  const model = () =>
    state.models.find((option) => option.id === state.model)?.label ??
    catalogModelLabel(state.model, state.models);
  const value = () => (
    <>
      <ModelIcon
        model={state.model}
        class={props.mobile ? 'size-[18px]' : 'size-4'}
      />
      <span class="min-w-0 truncate">{model()}</span>
    </>
  );
  return (
    <div
      class={cn(
        'flex h-6 items-center justify-between gap-2 px-1.5 text-xs',
        props.mobile && 'h-8 px-2.5 text-sm leading-5'
      )}
    >
      <div class="flex items-center gap-0.5 text-ink-extra-muted">
        <span>{t('agentControls.model')}</span>
        <Show
          when={state.model !== state.agent?.defaultModel && state.onKeepModel}
        >
          <Button
            variant="ghost"
            appearance="bare"
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
            class={cn(
              'size-6 min-h-6 rounded-full text-ink-extra-muted not-touch:hover:bg-hover active:bg-active',
              props.mobile && 'size-8 min-h-8'
            )}
          >
            <Show
              when={state.modelKept}
              fallback={<Pin class={props.mobile ? 'size-4' : 'size-3.5'} />}
            >
              <PinFill
                class={cn('text-accent', props.mobile ? 'size-4' : 'size-3.5')}
              />
            </Show>
          </Button>
        </Show>
      </div>
      <Show
        when={state.models.length > 1}
        fallback={
          <div
            class={cn(
              'flex min-w-0 items-center gap-1 text-ink font-medium text-sm',
              props.mobile && 'text-base leading-[22px]'
            )}
          >
            {value()}
          </div>
        }
      >
        <Button
          variant="ghost"
          appearance="bare"
          disabled={state.disabled}
          onClick={props.onModels}
          class={cn(
            'h-6 min-h-6 min-w-0 gap-1 rounded-full pl-2 pr-1.5 text-sm font-medium text-ink not-touch:hover:bg-hover active:bg-active',
            props.mobile && 'h-8 min-h-8 gap-1 text-base leading-[22px]'
          )}
        >
          {value()}
          <CaretRight
            class={
              props.mobile
                ? 'size-4 shrink-0 text-ink-extra-muted'
                : 'size-3 shrink-0 text-ink-extra-muted'
            }
          />
        </Button>
      </Show>
    </div>
  );
}
