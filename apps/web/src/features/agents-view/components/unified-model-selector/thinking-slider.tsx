import { t } from '@app/lib/i18n';
import { Slider } from '@ui';
import { cn } from '@ui/utils/classname';
import { For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../../../block-agent/state/session-config';
import { thinkingChoice, thinkingLevel } from '../../core/thinking-level';

export function ThinkingSlider(props: {
  effort?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
  mobile?: boolean;
  onCommit: (choice: EffortChoice) => void;
}) {
  let gestureOption: SelectSessionConfigOption | undefined;
  const [gesture, setGesture] = createStore<{
    level?: number;
    dragging: boolean;
  }>({ dragging: false });
  const available = () => (props.effort?.options.length ?? 0) > 1;
  const level = () =>
    gestureOption === props.effort && gesture.level !== undefined
      ? gesture.level
      : thinkingLevel(props.effort, props.value);
  const max = () => Math.max(1, (props.effort?.options.length ?? 1) - 1);
  const ratio = () => level() / max();
  const inset = () => (props.mobile ? 26 : 21);
  const begin = () => {
    if (props.disabled) return;
    gestureOption = props.effort;
    setGesture({ level: level(), dragging: true });
  };
  const commit = (next: number) => {
    if (!props.disabled) {
      const choice = thinkingChoice(props.effort, next);
      if (choice) props.onCommit(choice);
    }
  };
  return (
    <div
      class="flex flex-col"
      classList={{ 'gap-2': !props.mobile, 'gap-2.5': Boolean(props.mobile) }}
    >
      <div
        class={cn(
          'flex h-4 items-center justify-between text-xs text-ink-extra-muted',
          props.mobile && 'h-5 text-sm leading-5 text-ink-muted'
        )}
      >
        <span classList={{ 'opacity-50': !available() }}>
          {t('agentControls.thinking')}
        </span>
        <Show when={available()}>
          <span class="font-medium text-ink">
            {thinkingChoice(props.effort, level())?.name}
          </span>
        </Show>
      </div>
      <Show
        when={available()}
        fallback={
          <div
            class={cn(
              'flex h-6 items-center justify-center rounded-full bg-ink/12 text-xs text-ink-extra-muted',
              props.mobile && 'h-10 text-sm leading-5'
            )}
          >
            {t('agentControls.thinkingUnavailable')}
          </div>
        }
      >
        <Slider
          value={[level()]}
          minValue={0}
          maxValue={max()}
          step={1}
          disabled={props.disabled}
          getValueLabel={({ values }) =>
            thinkingChoice(props.effort, values[0])?.name ?? ''
          }
          onChange={(values) => {
            if (gesture.dragging) setGesture({ level: values[0] });
            else commit(values[0]);
          }}
          onChangeEnd={(values) => {
            if (!gesture.dragging) return;
            // Kobalte can report its last controlled value before the preview
            // propagates back through the root. Commit the value the user sees.
            if (gestureOption === props.effort)
              commit(gesture.level ?? values[0]);
            setGesture({ dragging: false, level: undefined });
          }}
          class="gap-0"
        >
          <div
            class={cn(
              'h-6 overflow-clip rounded-full bg-ink/12',
              props.mobile && 'h-10'
            )}
          >
            <Slider.Track
              onPointerDown={begin}
              onPointerCancel={() =>
                setGesture({ dragging: false, level: undefined })
              }
              class="my-0 h-full rounded-none bg-transparent before:inset-0"
              style={{
                'margin-inline': `${inset()}px`,
                width: `calc(100% - ${inset() * 2}px)`,
              }}
            >
              <Slider.Fill
                style={{
                  left: `-${inset()}px`,
                  right: 'auto',
                  width: `calc(${ratio() * 100}% + ${inset() * 2}px)`,
                }}
                class="rounded-full bg-accent"
              />
              <For each={props.effort?.options}>
                {(_, index) => (
                  <span
                    aria-hidden="true"
                    class={cn(
                      'pointer-events-none absolute top-2.5 size-1 rounded-full -translate-x-1/2',
                      props.mobile && 'top-[17px] size-1.5'
                    )}
                    style={{
                      left: `${(index() / max()) * 100}%`,
                      opacity: index() === level() ? 0 : 1,
                      background:
                        index() < level()
                          ? 'var(--color-accent-contrast-muted)'
                          : 'color-mix(in oklab, var(--color-ink-extra-muted) 40%, transparent)',
                    }}
                  />
                )}
              </For>
              <Slider.Thumb
                appearance="switch"
                aria-label={t('agentControls.thinking')}
                aria-valuetext={thinkingChoice(props.effort, level())?.name}
                onPointerDown={begin}
                onPointerCancel={() =>
                  setGesture({ dragging: false, level: undefined })
                }
                class={cn(
                  'h-[18px] w-9 border-0 rounded-[9px] focus-visible:ring-offset-2 focus-visible:ring-accent after:inset-x-0 after:-inset-y-1.5',
                  props.mobile && 'h-8 w-11 rounded-2xl'
                )}
                style={{
                  'box-shadow': gesture.dragging
                    ? '0 0 0 .5px #0000001F, 0 2px 8px #00000059'
                    : '0 0 0 .5px #0000001F, 0 1px 2px #00000040',
                }}
              >
                <Show when={props.mobile && gesture.dragging}>
                  <span
                    aria-hidden="true"
                    class="pointer-events-none absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/16"
                  />
                </Show>
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </div>
        </Slider>
      </Show>
    </div>
  );
}
