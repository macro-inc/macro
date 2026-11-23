import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import StopIcon from '@icon/system/regular/stop.svg';
import { Combobox } from '@kobalte/core/combobox';
import {
  fetchVoiceSample,
  useVoiceCatalogQuery,
} from '@queries/team-agents/voices';
import type { Voice } from '@service-agent-harness/generated/schemas';
import { Button, Layer, selectTriggerClasses } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { VoicePickerSource } from '../core/voices';

/** The provider catalog and cached samples for one team. */
export function useVoicePickerSource(
  teamId: Accessor<string>
): VoicePickerSource {
  const catalog = useVoiceCatalogQuery(teamId);
  return {
    choices: () => (catalog.isSuccess ? catalog.data : []),
    loading: () => catalog.isLoading,
    failed: () => catalog.isError,
    retry: () => fireAndForget(catalog.refetch(), 'team-agent.voices.retry'),
    sample: (model) => fetchVoiceSample(teamId(), model),
  };
}

const describeVoice = (voice: Voice) =>
  [voice.accent, ...voice.tags].join(' · ');

/**
 * A searchable list of provider voices with a Play sample button. A sample
 * stops, and its object URL is revoked, when the selection changes or the
 * picker unmounts.
 */
export function VoicePicker(props: {
  source: VoicePickerSource;
  value: string | undefined;
  onChange(model: string): void;
  disabled?: boolean;
}) {
  const labelId = createUniqueId();
  let input: HTMLInputElement | undefined;
  const [loading, setLoading] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  // Bumped on every stop, so a sample that arrives late is dropped.
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

  const play = async (model: string) => {
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
      if (current !== generation) return;
      setLoading(false);
      setPlaying(true);
    } catch {
      if (current !== generation) return;
      stop();
      setFailed(true);
    }
  };

  const toggle = () => {
    if (playing() || loading()) {
      stop();
      return;
    }
    const model = props.value;
    if (model) fireAndForget(play(model), 'team-agent.voice.preview');
  };

  const selected = () =>
    props.source.choices().find((voice) => voice.model === props.value);

  return (
    <div class="flex flex-col gap-2">
      <div id={labelId} class="text-sm font-medium text-ink">
        {t('teamAgents.voice')}
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <Combobox<Voice>
          class="min-w-0 flex-1"
          options={[...props.source.choices()]}
          value={selected() ?? null}
          onChange={(voice) => {
            if (voice) props.onChange(voice.model);
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
            props.source.choices().length === 0
          }
          placeholder={
            props.source.loading()
              ? t('teamAgents.loadingVoices')
              : t('teamAgents.chooseVoice')
          }
          itemComponent={(item) => (
            <Combobox.Item
              item={item.item}
              // Keep virtual focus in the search input.
              on:mousedown={(event: MouseEvent) => event.preventDefault()}
              aria-label={item.item.rawValue.name}
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-highlighted:bg-ink/5 touch:min-h-11"
            >
              <span class="min-w-0 flex-1">
                <Combobox.ItemLabel class="block truncate text-ink">
                  {item.item.rawValue.name}
                </Combobox.ItemLabel>
                <span class="block truncate text-xs text-ink-muted">
                  {describeVoice(item.item.rawValue)}
                </span>
              </span>
              <Combobox.ItemIndicator class="shrink-0 text-accent">
                <CheckIcon class="size-3" />
              </Combobox.ItemIndicator>
            </Combobox.Item>
          )}
        >
          <Combobox.Control
            class={selectTriggerClasses('min-w-0 touch:min-h-11')}
          >
            <Combobox.Input
              ref={input}
              aria-labelledby={labelId}
              class="min-w-0 w-full bg-transparent text-sm text-ink outline-none"
            />
            <Combobox.Trigger
              aria-label={t('teamAgents.showVoices')}
              class="shrink-0 text-ink-extra-muted"
            >
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
          type="button"
          variant="secondary"
          size="sm"
          class="shrink-0 touch:min-h-11"
          disabled={props.disabled || !props.value}
          onClick={toggle}
        >
          <Show
            when={playing() || loading()}
            fallback={
              <>
                <PlayIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
                {t('teamAgents.playSample')}
              </>
            }
          >
            <StopIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
            {t('teamAgents.stopSample')}
          </Show>
        </Button>
      </div>
      <Show when={props.source.failed()}>
        <div
          role="alert"
          class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
        >
          <span>{t('teamAgents.voicesFailed')}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => props.source.retry()}
          >
            {t('teamAgents.tryAgain')}
          </Button>
        </div>
      </Show>
      <Show when={failed()}>
        <p role="alert" class="text-sm text-failure">
          {t('teamAgents.sampleFailed')}
        </p>
      </Show>
    </div>
  );
}
