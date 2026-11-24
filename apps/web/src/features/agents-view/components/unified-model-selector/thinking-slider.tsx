import { t } from '@app/lib/i18n';
import { Button, Slider } from '@ui';
import { createSignal, Show } from 'solid-js';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../../../block-agent/state/session-config';
import { thinkingChoice, thinkingLevel } from '../../core/thinking-level';

export function ThinkingSlider(props: {
  effort?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
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
  let thumb: HTMLSpanElement | undefined;
  const available = () => (props.effort?.options.length ?? 0) > 1;
  const level = () =>
    previewLevel() ?? thinkingLevel(props.effort, props.value);
  const max = () => Math.max(1, (props.effort?.options.length ?? 1) - 1);
  const commit = (next: number) => {
    if (props.disabled) return;
    const choice = thinkingChoice(props.effort, next);
    if (choice) props.onCommit(choice);
  };
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-ink-extra-muted">
          {t('agentControls.thinking')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={props.disabled || !available()}
          aria-label={`${t('agentControls.thinking')}: ${thinkingChoice(props.effort, level())?.name ?? t('agentControls.thinkingUnavailable')}`}
          onClick={() => thumb?.focus()}
        >
          {available()
            ? thinkingChoice(props.effort, level())?.name
            : t('agentControls.thinkingUnavailable')}
        </Button>
      </div>
      <Show when={available()}>
        <Slider
          tone="neutral"
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
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb
              ref={thumb}
              aria-label={t('agentControls.thinking')}
              aria-valuetext={thinkingChoice(props.effort, level())?.name}
              onKeyDown={() => {
                keyboard = true;
                queueMicrotask(() => {
                  keyboard = false;
                });
              }}
            >
              <Slider.Input />
            </Slider.Thumb>
          </Slider.Track>
        </Slider>
      </Show>
    </div>
  );
}
