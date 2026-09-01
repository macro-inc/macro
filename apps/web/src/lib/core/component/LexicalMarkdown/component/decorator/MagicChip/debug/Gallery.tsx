/**
 * Visual playground for the Magic Chip. Fixture presentations only — no fold,
 * no session. Mounted at /app/component/magic-chip (LOCAL_ONLY).
 */

import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { DebugSlider } from '@core/component/Slider';
import { ToggleSwitch } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { deriveMagicChipDisplay } from '../display';
import { MagicChipView } from '../MagicChipView';
import type {
  MagicChipActivityIcon,
  MagicChipPresentation,
} from '../presentation';

const DEBUG_AGENT = { name: 'Macro' };

const LONG_ANSWER =
  'I looked through the channel list and the chip was growing the virtua row as the answer streamed in. The collapsed pill keeps a fixed 48px frame so older threads do not jump while this one writes.';

const HEADING_ANSWER = `## What changed

The preview chip is a pill. Click it to open the session, or expand inline from the hover action.`;

type Fixture = {
  id: string;
  label: string;
  presentation: MagicChipPresentation;
};

const FIXTURES: Fixture[] = [
  {
    id: 'loading',
    label: 'Loading',
    presentation: { kind: 'loading' },
  },
  {
    id: 'booting',
    label: 'Booting',
    presentation: {
      kind: 'working',
      activity: {
        icon: 'boot',
        label: 'Booting agent',
        detail: 'Preparing workspace',
        busy: true,
      },
    },
  },
  {
    id: 'thinking',
    label: 'Thinking',
    presentation: {
      kind: 'working',
      activity: {
        icon: 'think',
        label: 'Thinking',
        detail: 'Inspecting the repository',
        busy: true,
      },
    },
  },
  {
    id: 'waiting',
    label: 'Waiting',
    presentation: {
      kind: 'working',
      activity: { icon: 'wait', label: 'Waiting for agent', busy: true },
    },
  },
  {
    id: 'command',
    label: 'Command',
    presentation: {
      kind: 'working',
      activity: {
        icon: 'terminal',
        label: 'Running command',
        detail: 'cargo test -p agent_fold',
        busy: true,
      },
    },
  },
  {
    id: 'permission',
    label: 'Permission',
    presentation: {
      kind: 'working',
      activity: { icon: 'permission', label: 'Permission needed', busy: false },
    },
  },
  {
    id: 'writing-short',
    label: 'Writing short',
    presentation: {
      kind: 'answering',
      markdown: 'Looking at the tests.',
      activity: { icon: 'write', label: 'Writing response', busy: true },
    },
  },
  {
    id: 'writing-long',
    label: 'Writing long',
    presentation: {
      kind: 'answering',
      markdown: LONG_ANSWER,
      activity: { icon: 'write', label: 'Writing response', busy: true },
    },
  },
  {
    id: 'settled-short',
    label: 'Settled short',
    presentation: { kind: 'settled', markdown: '**Fixed.**' },
  },
  {
    id: 'settled-long',
    label: 'Settled long',
    presentation: { kind: 'settled', markdown: LONG_ANSWER },
  },
  {
    id: 'settled-heading',
    label: 'Settled heading',
    presentation: { kind: 'settled', markdown: HEADING_ANSWER },
  },
];

const WIDTH_PRESETS = [
  { id: 160, label: '160' },
  { id: 240, label: '240' },
  { id: 320, label: '320' },
  { id: 480, label: '480' },
  { id: 'full', label: 'Full' },
] as const;

type Kind = MagicChipPresentation['kind'];
type ContainerWidth = number | 'full';

const PLAY_IDS = [
  'loading',
  'booting',
  'thinking',
  'command',
  'permission',
  'writing-short',
  'writing-long',
  'settled-short',
] as const;

const KINDS: { id: Kind; label: string }[] = [
  { id: 'loading', label: 'Loading' },
  { id: 'working', label: 'Working' },
  { id: 'answering', label: 'Answering' },
  { id: 'settled', label: 'Settled' },
];

const ICONS: { id: MagicChipActivityIcon; label: string }[] = [
  { id: 'boot', label: 'Boot' },
  { id: 'think', label: 'Think' },
  { id: 'wait', label: 'Wait' },
  { id: 'write', label: 'Write' },
  { id: 'terminal', label: 'Term' },
  { id: 'edit', label: 'Edit' },
  { id: 'read', label: 'Read' },
  { id: 'search', label: 'Search' },
  { id: 'permission', label: 'Perm' },
  { id: 'plan', label: 'Plan' },
  { id: 'stop', label: 'Stop' },
  { id: 'error', label: 'Error' },
  { id: 'disconnect', label: 'Disc' },
  { id: 'gear', label: 'Gear' },
];

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3 rounded border border-edge-muted p-4">
      <h2 class="font-mono text-sm text-ink-muted">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Segment<T extends string | number>(props: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="flex flex-wrap gap-1">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="rounded px-2 py-1 text-xs"
            classList={{
              'bg-active text-ink': props.value === option.id,
              'text-ink-muted hover:bg-hover': props.value !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="flex min-w-0 flex-col gap-1">
      <span class="text-xxs uppercase tracking-wide text-ink-extra-muted">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-edge-muted bg-surface px-2 py-1 text-xs text-ink';

function Playground() {
  const [kind, setKind] = createSignal<Kind>('working');
  const [icon, setIcon] = createSignal<MagicChipActivityIcon>('boot');
  const [label, setLabel] = createSignal('Booting agent');
  const [detail, setDetail] = createSignal('Preparing workspace');
  const [busy, setBusy] = createSignal(true);
  const [markdown, setMarkdown] = createSignal(LONG_ANSWER);
  const [openedByReader, setOpenedByReader] = createSignal(false);
  const [containerWidth, setContainerWidth] =
    createSignal<ContainerWidth>(320);
  const [lastAction, setLastAction] = createSignal('none');
  const [playing, setPlaying] = createSignal(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  const stopPlay = () => {
    clearInterval(playTimer);
    playTimer = undefined;
    setPlaying(false);
  };

  onCleanup(stopPlay);

  const activity = () => ({
    icon: icon(),
    label: label(),
    detail: detail().trim() || undefined,
    busy: busy(),
  });

  const presentation = (): MagicChipPresentation => {
    const next = kind();
    if (next === 'loading') return { kind: 'loading' };
    if (next === 'working') {
      return { kind: 'working', activity: activity() };
    }
    if (next === 'answering') {
      return { kind: 'answering', markdown: markdown(), activity: activity() };
    }
    return { kind: 'settled', markdown: markdown() };
  };

  const display = () =>
    deriveMagicChipDisplay({
      presentation: presentation(),
      openedByReader: openedByReader(),
      agent: DEBUG_AGENT,
    });

  const applyFixture = (fixture: Fixture) => {
    const next = fixture.presentation;
    setKind(next.kind);
    if (next.kind === 'working' || next.kind === 'answering') {
      setIcon(next.activity.icon);
      setLabel(next.activity.label);
      setDetail(next.activity.detail ?? '');
      setBusy(next.activity.busy);
    }
    if (next.kind === 'answering' || next.kind === 'settled') {
      setMarkdown(next.markdown);
    }
  };

  const containerStyle = () =>
    containerWidth() === 'full'
      ? { width: '100%' }
      : { width: `${containerWidth()}px` };

  return (
    <Section title="Playground">
      <div class="flex flex-col gap-4 lg:flex-row">
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <Field label="Fixture">
            <div class="flex flex-wrap gap-1">
              <button
                type="button"
                class="rounded px-2 py-1 text-xs"
                classList={{
                  'bg-active text-ink': playing(),
                  'text-ink-muted hover:bg-hover': !playing(),
                }}
                onClick={() => {
                  if (playing()) {
                    stopPlay();
                    return;
                  }
                  setPlaying(true);
                  let step = 0;
                  const play = () => {
                    const id = PLAY_IDS[step % PLAY_IDS.length];
                    const fixture = FIXTURES.find((entry) => entry.id === id);
                    if (fixture) applyFixture(fixture);
                    step += 1;
                  };
                  play();
                  playTimer = setInterval(play, 900);
                }}
              >
                {playing() ? 'Stop' : 'Play states'}
              </button>
              <For each={FIXTURES}>
                {(fixture) => (
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs text-ink-muted hover:bg-hover"
                    onClick={() => {
                      stopPlay();
                      applyFixture(fixture);
                    }}
                  >
                    {fixture.label}
                  </button>
                )}
              </For>
            </div>
          </Field>
          <Field label="Kind">
            <Segment value={kind()} options={KINDS} onChange={setKind} />
          </Field>
          <div class="flex items-center gap-3">
            <span class="text-xxs uppercase tracking-wide text-ink-extra-muted">
              Opened by reader
            </span>
            <ToggleSwitch
              checked={openedByReader()}
              onChange={setOpenedByReader}
            />
          </div>
          <Show when={kind() === 'working' || kind() === 'answering'}>
            <Field label="Icon">
              <Segment value={icon()} options={ICONS} onChange={setIcon} />
            </Field>
            <Field label="Accessible name">
              <input
                class={inputClass}
                value={label()}
                onInput={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>
            <Field label="Body / detail">
              <input
                class={inputClass}
                value={detail()}
                onInput={(event) => setDetail(event.currentTarget.value)}
              />
            </Field>
            <div class="flex items-center gap-3">
              <span class="text-xxs uppercase tracking-wide text-ink-extra-muted">
                Busy
              </span>
              <ToggleSwitch checked={busy()} onChange={setBusy} />
            </div>
          </Show>
          <Show when={kind() === 'answering' || kind() === 'settled'}>
            <Field label="Markdown">
              <textarea
                class={`${inputClass} min-h-24 font-mono`}
                value={markdown()}
                onInput={(event) => setMarkdown(event.currentTarget.value)}
              />
            </Field>
          </Show>
          <Field label="Container width">
            <Segment
              value={containerWidth()}
              options={WIDTH_PRESETS}
              onChange={setContainerWidth}
            />
          </Field>
          <Show
            when={containerWidth() !== 'full' ? containerWidth() : undefined}
          >
            {(width) => (
              <DebugSlider
                label="Width px"
                value={width()}
                onChange={setContainerWidth}
                min={120}
                max={640}
                step={8}
              />
            )}
          </Show>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="text-xxs uppercase tracking-wide text-ink-extra-muted">
            {display().mode} · last action {lastAction()}
          </div>
          <div
            class="rounded border border-dashed border-edge-muted bg-surface p-3"
            style={containerStyle()}
          >
            <MagicChipView
              agentSessionId="debug"
              display={display()}
              actions={{
                openSession: () => setLastAction('open session'),
                setOpened: (opened) => {
                  setOpenedByReader(opened);
                  setLastAction(opened ? 'expand' : 'collapse');
                },
              }}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

const Preview: Component<{
  fixture: Fixture;
  openedByReader: boolean;
}> = (props) => {
  const [opened, setOpened] = createSignal(props.openedByReader);
  const display = () =>
    deriveMagicChipDisplay({
      presentation: props.fixture.presentation,
      openedByReader: opened(),
      agent: DEBUG_AGENT,
    });

  return (
    <div class="flex min-w-0 flex-col gap-1 rounded border border-edge-muted/40 p-2">
      <div class="truncate text-xxs text-ink-extra-muted">
        {props.fixture.label}
        {props.openedByReader ? ' · opened' : ''}
      </div>
      <MagicChipView
        agentSessionId={props.fixture.id}
        display={display()}
        actions={{
          openSession: () => console.info('[magic-chip] open session'),
          setOpened,
        }}
      />
    </div>
  );
};

export default function MagicChipGallery() {
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Magic Chip" />
      </SplitHeaderLeft>
      <div class="size-full overflow-auto p-4">
        <div class="mx-auto flex max-w-5xl flex-col gap-4">
          <Playground />
          <Section title="Pills">
            <div class="grid gap-3 md:grid-cols-2">
              <For each={FIXTURES}>
                {(fixture) => (
                  <Preview fixture={fixture} openedByReader={false} />
                )}
              </For>
            </div>
          </Section>
          <Section title="Opened">
            <div class="grid gap-3 md:grid-cols-2">
              <For each={FIXTURES}>
                {(fixture) => (
                  <Preview fixture={fixture} openedByReader={true} />
                )}
              </For>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
