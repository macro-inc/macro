import { t } from '@app/lib/i18n';
import { Slider } from '@ui';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show } from 'solid-js';
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
  const [preview, setPreview] = createSignal<{
    effort: SelectSessionConfigOption | undefined;
    value: string | undefined;
    level: number;
  }>();
  const previewLevel = () => {
    const draft = preview();
    if (draft?.effort === props.effort && draft?.value === props.value)
      return draft?.level;
  };
  let keyboard = false;
  const available = () => (props.effort?.options.length ?? 0) > 1;
  const level = () =>
    previewLevel() ?? thinkingLevel(props.effort, props.value);
  const max = () => Math.max(1, (props.effort?.options.length ?? 1) - 1);
  const ratio = () => level() / max();
  const inset = () => (props.mobile ? 26 : 21);
  const commit = (next: number) => {
    if (props.disabled) return;
    const choice = thinkingChoice(props.effort, next);
    if (choice) props.onCommit(choice);
  };
  return (
    <div
      class="flex flex-col"
      classList={{ 'gap-2': !props.mobile, 'gap-2.5': Boolean(props.mobile) }}
    >
      <div
        class={cn(
          'flex h-4 items-center justify-between px-1.5 text-xs text-ink-extra-muted',
          props.mobile && 'h-5 px-2.5 text-sm leading-5 text-ink-muted'
        )}
      >
        <span classList={{ 'opacity-50': !available() }}>
          {t('agentControls.thinking')}
        </span>
        <Show when={available()}>
          <span
            class={cn(
              'font-medium text-ink text-sm',
              props.mobile && 'text-base leading-[22px]'
            )}
          >
            {thinkingChoice(props.effort, level())?.name}
          </span>
        </Show>
      </div>
      <Show
        when={available()}
        fallback={
          <div
            class={cn(
              'flex h-6 items-center justify-center rounded-full bg-selected text-xs text-ink-extra-muted',
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
          onPointerCancel={() => setPreview(undefined)}
          onChange={(values) => {
            if (props.disabled) return;
            if (keyboard) commit(values[0]);
            else
              setPreview({
                effort: props.effort,
                value: props.value,
                level: values[0],
              });
          }}
          onChangeEnd={() => {
            const next = previewLevel();
            if (next !== undefined) commit(next);
            setPreview(undefined);
          }}
          class="gap-0"
        >
          <div
            class={cn('h-6 rounded-full bg-selected', props.mobile && 'h-10')}
            style={{ 'padding-inline': `${inset()}px` }}
          >
            <Slider.Track class="m-0 h-full rounded-none bg-transparent before:inset-0">
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
                      opacity:
                        index() === level() ? 0 : index() < level() ? 1 : 0.4,
                      background:
                        index() < level()
                          ? 'var(--color-accent-contrast-muted)'
                          : 'var(--color-ink-extra-muted)',
                    }}
                  />
                )}
              </For>
              <Slider.Thumb
                appearance="switch"
                aria-label={t('agentControls.thinking')}
                onKeyDown={() => {
                  keyboard = true;
                  queueMicrotask(() => {
                    keyboard = false;
                  });
                }}
                aria-valuetext={thinkingChoice(props.effort, level())?.name}
                class={cn(
                  'h-[18px] w-9 border-0 rounded-[9px] focus-visible:ring-offset-2 focus-visible:ring-accent after:inset-x-0 after:-inset-y-1.5',
                  props.mobile && 'h-8 w-11 rounded-2xl'
                )}
                style={{
                  'box-shadow':
                    previewLevel() !== undefined
                      ? 'var(--shadow-elevated)'
                      : 'var(--shadow-menu)',
                }}
              >
                <Show when={props.mobile && previewLevel() !== undefined}>
                  <span
                    aria-hidden="true"
                    class="pointer-events-none absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-selected"
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
