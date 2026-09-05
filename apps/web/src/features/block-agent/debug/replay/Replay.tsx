/**
 * Replay harness: drive the real block-agent stack from a recorded session.
 *
 * Load a `~/.agent_runtime_sessions/<id>.jsonl` recording, choose where the
 * "persisted log" ends, and stream the rest frame by frame through the real
 * realtime path. Everything below the control bar is the production stack —
 * `AgentSessionProvider`, worker fold, `Transcript`, `AgentComposer` —
 * served by `interceptor.ts` instead of the harness service. Mounted at
 * `/component/agent-replay`.
 */

import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { createSignal, onCleanup, Show } from 'solid-js';
import { AgentComposer } from '../../component/AgentComposer';
import { Transcript } from '../../component/Transcript';
import {
  AgentSessionProvider,
  useAgentSession,
} from '../../context/AgentSessionContext';
import { SessionStatusPill } from '../../ui';
import { createReplayDriver, type ReplayDriver } from './driver';
import { registerReplaySession } from './interceptor';
import { parseRecording } from './recording';

type MountedSession = {
  id: string;
  driver: ReplayDriver;
  unregister: () => void;
};

function Knob(props: {
  label: string;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <label class="flex items-center gap-1.5 text-xs text-ink-muted">
      {props.label}
      {props.children}
    </label>
  );
}

function SessionChrome() {
  const { status, working } = useAgentSession();
  return (
    <div class="flex items-center gap-2 border-b border-edge-muted px-4 py-2">
      <SessionStatusPill status={status()} />
      <Show when={working()}>
        <span class="text-xs text-ink-extra-muted">working…</span>
      </Show>
    </div>
  );
}

export default function AgentReplay() {
  const [recording, setRecording] = createSignal<{
    name: string;
    entries: AgentSessionLogEntryDto[];
  }>();
  const [loadError, setLoadError] = createSignal<string>();

  // Applied at (re)mount.
  const [splitPct, setSplitPct] = createSignal(100);
  const [fetchDelayMs, setFetchDelayMs] = createSignal(0);
  const [overlap, setOverlap] = createSignal(0);
  // Read live, per frame / per control call.
  const [frameIntervalMs, setFrameIntervalMs] = createSignal(150);
  const [controlFails, setControlFails] = createSignal(false);

  const [mounted, setMounted] = createSignal<MountedSession>();
  // The driver's cursor/playing signals live inside the mounted session, so
  // reading them through `mounted()` keeps the transport reactive.
  const cursor = () => mounted()?.driver.cursor() ?? 0;
  const playing = () => mounted()?.driver.playing() ?? false;

  const teardown = () => {
    const current = mounted();
    if (!current) return;
    current.driver.dispose();
    current.unregister();
    setMounted(undefined);
  };
  onCleanup(teardown);

  const mount = () => {
    const loaded = recording();
    if (!loaded) return;
    teardown();
    // A real UUID: the fold's wasm side parses the session id, so a
    // `replay-1`-style marker crashes it. The interceptor routes by
    // registration, not by the id's shape.
    const id = crypto.randomUUID();
    const splitIndex = Math.round((loaded.entries.length * splitPct()) / 100);
    const driver = createReplayDriver({
      agentSessionId: id,
      entries: loaded.entries,
      splitIndex,
      overlap: overlap(),
      fetchDelayMs: fetchDelayMs(),
      frameIntervalMs,
      controlFails,
    });
    const unregister = registerReplaySession(id, driver.backend);
    setMounted({ id, driver, unregister });
  };

  const loadFile = async (file: File) => {
    try {
      const entries = parseRecording(await file.text());
      if (entries.length === 0) throw new Error('recording is empty');
      setLoadError(undefined);
      setRecording({ name: file.name, entries });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setRecording(undefined);
    }
    teardown();
  };

  return (
    <div
      class="size-full overflow-hidden flex flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer?.files[0];
        if (file) void loadFile(file);
      }}
    >
      <div class="flex flex-col gap-2 border-b border-edge-muted px-4 py-3">
        <div class="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".jsonl"
            class="text-xs text-ink-muted"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void loadFile(file);
            }}
          />
          <Show when={recording()}>
            {(loaded) => (
              <span class="text-xs text-ink-extra-muted">
                {loaded().name} · {loaded().entries.length} frames
              </span>
            )}
          </Show>
          <Show when={loadError()}>
            <span class="text-xs text-failure">{loadError()}</span>
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <Knob label={`log ${splitPct()}%`}>
            <input
              type="range"
              min="0"
              max="100"
              value={splitPct()}
              onInput={(event) =>
                setSplitPct(Number(event.currentTarget.value))
              }
            />
          </Knob>
          <Knob label="frame ms">
            <select
              class="rounded border border-edge-muted bg-transparent px-1 py-0.5"
              value={frameIntervalMs()}
              onChange={(event) =>
                setFrameIntervalMs(Number(event.currentTarget.value))
              }
            >
              <option value="30">30</option>
              <option value="150">150</option>
              <option value="400">400</option>
              <option value="1000">1000</option>
            </select>
          </Knob>
          <Knob label="fetch delay">
            <select
              class="rounded border border-edge-muted bg-transparent px-1 py-0.5"
              value={fetchDelayMs()}
              onChange={(event) =>
                setFetchDelayMs(Number(event.currentTarget.value))
              }
            >
              <option value="0">none</option>
              <option value="1500">1.5s</option>
            </select>
          </Knob>
          <Knob label="overlap">
            <select
              class="rounded border border-edge-muted bg-transparent px-1 py-0.5"
              value={overlap()}
              onChange={(event) =>
                setOverlap(Number(event.currentTarget.value))
              }
            >
              <option value="0">0</option>
              <option value="5">5</option>
            </select>
          </Knob>
          <Knob label="control fails">
            <input
              type="checkbox"
              checked={controlFails()}
              onChange={(event) => setControlFails(event.currentTarget.checked)}
            />
          </Knob>
          <button
            type="button"
            class="rounded border border-edge-muted px-2 py-0.5 text-xs text-ink-muted hover:bg-hover"
            disabled={!recording()}
            onClick={mount}
          >
            {mounted() ? 'restart' : 'mount'}
          </button>
        </div>

        <Show when={mounted()}>
          {(session) => (
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="rounded border border-edge-muted px-2 py-0.5 text-xs text-ink-muted hover:bg-hover"
                onClick={() =>
                  playing() ? session().driver.pause() : session().driver.play()
                }
              >
                {playing() ? 'pause' : 'play'}
              </button>
              <button
                type="button"
                class="rounded border border-edge-muted px-2 py-0.5 text-xs text-ink-muted hover:bg-hover"
                onClick={() => session().driver.step()}
              >
                step
              </button>
              <span class="text-xs tabular-nums text-ink-extra-muted">
                {cursor()} / {session().driver.total}
              </span>
            </div>
          )}
        </Show>
      </div>

      <Show
        when={mounted()}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-ink-extra-muted">
            Drop a recording (~/.agent_runtime_sessions/*.jsonl), then mount.
          </div>
        }
        keyed
      >
        {(session) => (
          <AgentSessionProvider blockId={session.id}>
            <StaticMarkdownContext>
              <div class="flex-1 min-h-0 flex flex-col">
                <SessionChrome />
                <Transcript />
                <div class="shrink-0 w-full max-w-3xl mx-auto px-4 pb-4">
                  <AgentComposer />
                </div>
              </div>
            </StaticMarkdownContext>
          </AgentSessionProvider>
        )}
      </Show>
    </div>
  );
}
