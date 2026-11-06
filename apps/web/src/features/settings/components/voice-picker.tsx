import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Combobox } from '@kobalte/core/combobox';
import type { Voice } from '@service-agent-harness/generated/schemas';
import { Button, Layer, selectTriggerClasses } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { VoicePickerSource } from '../core/voices';

export function VoicePicker(props: {
  source: VoicePickerSource;
  value: string | undefined;
  onChange(model: string): void;
  disabled?: boolean;
}) {
  const label = createUniqueId();
  let input: HTMLInputElement | undefined;
  const [loading, setLoading] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let generation = 0;
  let audio: HTMLAudioElement | undefined;
  let url: string | undefined;
  const stop = () => {
    generation++;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    audio = undefined;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    setPlaying(false);
    setLoading(false);
  };
  onCleanup(stop);
  createEffect(on(() => props.value, stop, { defer: true }));
  const preview = async () => {
    if (playing() || loading()) {
      stop();
      return;
    }
    const model = props.value;
    if (!model) return;
    stop();
    const current = generation;
    setFailed(false);
    setLoading(true);
    try {
      const bytes = await props.source.sample(model);
      if (current !== generation) return;
      url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })
      );
      audio = new Audio(url);
      audio.onended = stop;
      audio.onerror = () => {
        stop();
        setFailed(true);
      };
      await audio.play();
      if (current === generation) setPlaying(true);
    } catch {
      if (current === generation) {
        stop();
        setFailed(true);
      }
    } finally {
      if (current === generation) setLoading(false);
    }
  };
  const selected = () =>
    props.source.choices().find((voice) => voice.model === props.value);
  return (
    <div class="space-y-2">
      <div id={label} class="text-sm font-medium">
        {t('agentInvite.voice')}
      </div>
      <div class="flex items-center gap-2">
        <Combobox<Voice>
          class="min-w-0 flex-1"
          options={props.source.choices()}
          value={selected() ?? null}
          onChange={(voice) => {
            if (voice) {
              stop();
              props.onChange(voice.model);
            }
          }}
          optionValue="model"
          optionTextValue={(voice) =>
            [voice.name, voice.accent, ...voice.tags].join(' ')
          }
          optionLabel="name"
          defaultFilter="contains"
          disabled={
            props.disabled ||
            props.source.loading() ||
            !props.source.choices().length
          }
          placeholder={
            props.source.loading()
              ? t('agentInvite.loadingVoices')
              : t('agentInvite.chooseVoice')
          }
          itemComponent={(item) => (
            <Combobox.Item
              item={item.item}
              on:mousedown={(event: MouseEvent) => event.preventDefault()}
              aria-label={item.item.rawValue.name}
              class="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-hover touch:min-h-11"
            >
              <span class="min-w-0 flex-1">
                <Combobox.ItemLabel class="capitalize">
                  {item.item.rawValue.name}
                </Combobox.ItemLabel>
                <span class="block text-xs text-ink-muted">
                  {[item.item.rawValue.accent, ...item.item.rawValue.tags].join(
                    ' · '
                  )}
                </span>
              </span>
              <Combobox.ItemIndicator>
                <CheckIcon class="size-3" />
              </Combobox.ItemIndicator>
            </Combobox.Item>
          )}
        >
          <Combobox.Control class={selectTriggerClasses('touch:min-h-11')}>
            <Combobox.Input
              ref={input}
              aria-labelledby={label}
              class="min-w-0 w-full bg-transparent text-sm text-ink outline-none"
            />
            <Combobox.Trigger aria-label={t('agentInvite.showVoices')}>
              <CaretDownIcon class="size-3" />
            </Combobox.Trigger>
          </Combobox.Control>
          <Combobox.Portal
            mount={input?.closest<HTMLElement>('.portal-scope') ?? undefined}
          >
            <Layer depth={3}>
              <Combobox.Content class="menu-surface z-action-menu max-h-[min(20rem,var(--kb-popper-content-available-height))] w-[var(--kb-popper-anchor-width)] max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5">
                <Combobox.Listbox />
              </Combobox.Content>
            </Layer>
          </Combobox.Portal>
        </Combobox>
        <Button
          variant="secondary"
          disabled={props.disabled || !props.value}
          onClick={() => fireAndForget(preview(), 'team-agent.voice.preview')}
        >
          {loading()
            ? t('agentInvite.cancelSample')
            : playing()
              ? t('agentInvite.stopSample')
              : t('agentInvite.playSample')}
        </Button>
      </div>
      <Show when={props.source.failed()}>
        <p role="alert" class="text-sm text-failure">
          {t('agentInvite.voicesFailed')}{' '}
          <Button variant="link" onClick={props.source.retry}>
            {t('agentInvite.tryAgain')}
          </Button>
        </p>
      </Show>
      <Show when={failed()}>
        <p role="alert" class="text-sm text-failure">
          {t('agentInvite.sampleFailed')}
        </p>
      </Show>
    </div>
  );
}
