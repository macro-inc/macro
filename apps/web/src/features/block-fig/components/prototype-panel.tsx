/**
 * The Prototype tab: the page's flows, the selected frame's flow starting
 * point, and the selected layer's interactions. Editors add, change, and
 * remove click interactions (Navigate to, Open overlay, Back) with a
 * transition and duration, as Figma's prototype panel does; interactions
 * the tab does not edit (hover, variants…) are listed as they are.
 * Presentational: data and actions come in as props.
 */

import type {
  PrototypeAction,
  PrototypeInfo,
  PrototypeInteraction,
} from '@core/fig-engine/prototype-types';
import Play from '@phosphor/play.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { createMemo, For, Show } from 'solid-js';
import {
  type ActionKind,
  actionKind,
  type ClickInteraction,
  flowsOf,
  TRANSITIONS,
} from '../core/prototype';

const TRIGGERS: Record<string, string> = {
  ON_CLICK: 'On click',
  ON_HOVER: 'While hovering',
  ON_PRESS: 'While pressing',
  DRAG: 'On drag',
  AFTER_TIMEOUT: 'After delay',
  MOUSE_ENTER: 'Mouse enter',
  MOUSE_LEAVE: 'Mouse leave',
  MOUSE_DOWN: 'Mouse down',
  MOUSE_UP: 'Mouse up',
  ON_KEY_DOWN: 'Key/Gamepad',
};

const label = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

const control =
  'min-w-0 rounded-md border border-edge-muted bg-input px-1.5 py-1 text-ink text-xs';
const select = `w-full ${control}`;

export function PrototypePanel(props: {
  info: PrototypeInfo | undefined;
  /** The single selected layer, if any. */
  selected: { id: string; name: string } | undefined;
  /** Edits; absent when the file is read-only. */
  onInteractions?: (
    id: string,
    index: number,
    edited: ClickInteraction | null
  ) => void;
  onFlowStart?: (frameId: string, name: string | null) => void;
  onPresent: (frameId?: string) => void;
}) {
  const frames = () => props.info?.frames ?? [];
  const frameName = (id: string | null | undefined) =>
    frames().find((f) => f.id === id)?.name ?? 'Unknown';
  const flows = () => (props.info ? flowsOf(props.info) : []);
  const interactions = createMemo((): PrototypeInteraction[] => {
    const id = props.selected?.id;
    if (!id) return [];
    return props.info?.hotspots.find((h) => h.id === id)?.interactions ?? [];
  });
  const selectedFrame = () => frames().find((f) => f.id === props.selected?.id);
  const flowAt = (id: string) => props.info?.flows.find((f) => f.frame === id);
  const editable = () =>
    !!props.onInteractions &&
    !!props.selected &&
    !props.selected.id.startsWith('I');
  const otherFrame = () =>
    frames().find(
      (f) =>
        f.id !== props.selected?.id &&
        f.id !==
          props.info?.hotspots.find((h) => h.id === props.selected?.id)?.frame
    ) ?? frames()[0];

  const summary = (a: PrototypeAction | undefined) => {
    if (!a) return 'None';
    if (a.connection === 'BACK') return 'Back';
    if (a.connection === 'CLOSE') return 'Close overlay';
    if (a.connection === 'URL') return `Open ${a.url ?? 'link'}`;
    if (a.connection !== 'INTERNAL_NODE') return 'None';
    const to = frameName(a.destination);
    return (
      {
        NAVIGATE: `Navigate to ${to}`,
        OVERLAY: `Open overlay ${to}`,
        SWAP: `Swap overlay ${to}`,
        SCROLL_TO: `Scroll to ${to}`,
        SWAP_STATE: 'Change to variant',
      }[a.navigation] ?? label(a.navigation)
    );
  };

  const edit = (
    index: number,
    i: PrototypeInteraction,
    change: Partial<ClickInteraction>
  ) => {
    const a = i.actions[0];
    const kind = actionKind(a) ?? 'navigate';
    const current: ClickInteraction = {
      id: i.id ?? undefined,
      kind,
      destination: a?.destination ?? otherFrame()?.id,
      transition: a?.transition ?? 'INSTANT_TRANSITION',
      duration: a?.duration ?? 0.3,
    };
    const id = props.selected?.id;
    if (id) props.onInteractions?.(id, index, { ...current, ...change });
  };

  return (
    <div
      class="flex flex-col text-ink text-xs"
      data-testid="fig-prototype-panel"
    >
      <Show when={selectedFrame()}>
        {(frame) => (
          <section class="flex flex-col gap-2 border-edge-muted border-b px-3 py-3">
            <div class="flex items-center">
              <span class="font-semibold">Flow starting point</span>
              <Show when={props.onFlowStart && !flowAt(frame().id)}>
                <button
                  type="button"
                  class="ml-auto rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
                  aria-label="Add flow starting point"
                  data-testid="fig-flow-add"
                  onClick={() =>
                    props.onFlowStart?.(
                      frame().id,
                      `Flow ${(props.info?.flows.length ?? 0) + 1}`
                    )
                  }
                >
                  <Plus class="size-3.5" />
                </button>
              </Show>
            </div>
            <Show when={flowAt(frame().id)}>
              {(flow) => (
                <div class="flex items-center gap-1">
                  <Show
                    when={props.onFlowStart}
                    fallback={<span class="flex-1">{flow().name}</span>}
                  >
                    <input
                      class={select}
                      value={flow().name}
                      aria-label="Flow name"
                      data-testid="fig-flow-name"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onChange={(e) => {
                        const name = e.currentTarget.value.trim();
                        if (name) props.onFlowStart?.(frame().id, name);
                      }}
                    />
                    <button
                      type="button"
                      class="rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
                      aria-label="Remove flow starting point"
                      data-testid="fig-flow-remove"
                      onClick={() => props.onFlowStart?.(frame().id, null)}
                    >
                      <Trash class="size-3.5" />
                    </button>
                  </Show>
                </div>
              )}
            </Show>
          </section>
        )}
      </Show>
      <Show when={props.selected}>
        <section class="flex flex-col gap-2 border-edge-muted border-b px-3 py-3">
          <div class="flex items-center">
            <span class="font-semibold">Interactions</span>
            <Show when={editable() && frames().length > 0}>
              <button
                type="button"
                class="ml-auto rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
                aria-label="Add interaction"
                data-testid="fig-proto-add"
                onClick={() => {
                  const id = props.selected?.id;
                  if (!id) return;
                  props.onInteractions?.(id, interactions().length, {
                    kind: 'navigate',
                    destination: otherFrame()?.id,
                    transition: 'INSTANT_TRANSITION',
                    duration: 0.3,
                  });
                }}
              >
                <Plus class="size-3.5" />
              </button>
            </Show>
          </div>
          <Show
            when={interactions().length > 0}
            fallback={
              <span class="text-ink-muted" data-testid="fig-proto-none">
                No interactions
              </span>
            }
          >
            <For each={interactions()}>
              {(i, index) => {
                const a = () => i.actions[0];
                const kind = () => actionKind(a());
                const editsThis = () =>
                  editable() && i.trigger === 'ON_CLICK' && !!kind();
                return (
                  <div
                    class="flex flex-col gap-1.5 rounded-md bg-inset p-2"
                    data-testid="fig-proto-interaction"
                  >
                    <div class="flex items-center gap-1">
                      <span class="font-medium">
                        {TRIGGERS[i.trigger] ?? label(i.trigger)}
                      </span>
                      <Show when={editable()}>
                        <button
                          type="button"
                          class="ml-auto rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
                          aria-label="Remove interaction"
                          data-testid="fig-proto-remove"
                          onClick={() => {
                            const id = props.selected?.id;
                            if (id) props.onInteractions?.(id, index(), null);
                          }}
                        >
                          <Trash class="size-3.5" />
                        </button>
                      </Show>
                    </div>
                    <Show
                      when={editsThis()}
                      fallback={
                        <span
                          class="text-ink-muted"
                          data-testid="fig-proto-summary"
                        >
                          {summary(a())}
                        </span>
                      }
                    >
                      <select
                        class={select}
                        aria-label="Action"
                        data-testid="fig-proto-action"
                        value={kind()}
                        onChange={(e) =>
                          edit(index(), i, {
                            kind: e.currentTarget.value as ActionKind,
                          })
                        }
                      >
                        <option value="navigate">Navigate to</option>
                        <option value="overlay">Open overlay</option>
                        <option value="back">Back</option>
                      </select>
                      <Show when={kind() !== 'back'}>
                        <select
                          class={select}
                          aria-label="Destination"
                          data-testid="fig-proto-destination"
                          value={a()?.destination ?? ''}
                          onChange={(e) =>
                            edit(index(), i, {
                              destination: e.currentTarget.value,
                            })
                          }
                        >
                          <For each={frames()}>
                            {(f) => <option value={f.id}>{f.name}</option>}
                          </For>
                        </select>
                      </Show>
                      <div class="flex gap-1">
                        <select
                          class={select}
                          aria-label="Animation"
                          data-testid="fig-proto-transition"
                          value={a()?.transition ?? 'INSTANT_TRANSITION'}
                          onChange={(e) =>
                            edit(index(), i, {
                              transition: e.currentTarget.value,
                            })
                          }
                        >
                          <Show
                            when={TRANSITIONS.some(
                              (t) => t.value === a()?.transition
                            )}
                            fallback={
                              <option value={a()?.transition}>
                                {label(a()?.transition ?? '')}
                              </option>
                            }
                          >
                            {null}
                          </Show>
                          <For each={TRANSITIONS}>
                            {(t) => <option value={t.value}>{t.label}</option>}
                          </For>
                        </select>
                        <Show when={a()?.transition !== 'INSTANT_TRANSITION'}>
                          <input
                            type="number"
                            min="0"
                            max="10000"
                            step="50"
                            class={`${control} w-16 shrink-0`}
                            aria-label="Duration (ms)"
                            title="Duration (ms)"
                            data-testid="fig-proto-duration"
                            value={Math.round((a()?.duration ?? 0.3) * 1000)}
                            onKeyDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const ms = Number(e.currentTarget.value);
                              if (Number.isFinite(ms) && ms >= 0)
                                edit(index(), i, { duration: ms / 1000 });
                            }}
                          />
                        </Show>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </section>
      </Show>
      <section class="flex flex-col gap-1.5 px-3 py-3">
        <span class="font-semibold">Flows</span>
        <Show
          when={flows().length > 0}
          fallback={
            <span class="text-ink-muted">
              Select a top-level frame to add a starting point.
            </span>
          }
        >
          <For each={flows()}>
            {(flow) => (
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-hover"
                data-testid="fig-flow"
                onClick={() => props.onPresent(flow.frame)}
              >
                <Play class="size-3.5 shrink-0 text-ink-muted" />
                <span class="truncate">{flow.name}</span>
                <span class="ml-auto truncate text-ink-muted">
                  {frameName(flow.frame)}
                </span>
              </button>
            )}
          </For>
        </Show>
      </section>
    </div>
  );
}
