/**
 * Variables in the design panel: the color variable a fill or stroke is
 * bound to (with a picker of the file's color variables and "Detach
 * variable"), a frame's variable modes, and the file's collections with
 * their variables' values per mode. Presentational: data and actions come
 * in as props.
 */

import type {
  CollectionInfo,
  ModeChoice,
  NodeRef,
  VariableInfo,
  VariableValueInfo,
} from '@core/fig-engine/design-types';
import { Popover } from '@kobalte/core/popover';
import Hexagon from '@phosphor/hexagon.svg';
import LinkBreak from '@phosphor/link-break.svg';
import { Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { splitStyleName } from '../core/design-system';
import { Section } from './panel-section';
import { PropertyRow } from './property-controls';

const cssColor = (v: VariableValueInfo) =>
  v.color
    ? `#${v.color}${Math.round((v.alpha ?? 1) * 255)
        .toString(16)
        .padStart(2, '0')}`
    : 'transparent';

/** A variable's value as a swatch or text. */
function ValuePreview(props: { value: VariableValueInfo | undefined }) {
  return (
    <Show
      when={props.value?.color}
      fallback={
        <span class="truncate text-ink-muted tabular-nums">
          {props.value?.alias ??
            props.value?.text ??
            (props.value?.number !== null && props.value?.number !== undefined
              ? String(Math.round(props.value.number * 100) / 100)
              : props.value?.bool !== null && props.value?.bool !== undefined
                ? String(props.value.bool)
                : '')}
        </span>
      }
    >
      <span
        class="size-3.5 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: props.value ? cssColor(props.value) : '' }}
      />
    </Show>
  );
}

/** The color variable a paint uses, and a picker to bind one. */
export function VariableControl(props: {
  kind: 'FILL' | 'STROKE';
  bound: NodeRef | null;
  collections: readonly CollectionInfo[];
  /** Absent when read-only. */
  onBind?: (variable: string | undefined) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const colors = (c: CollectionInfo): VariableInfo[] => {
    const q = query().trim().toLowerCase();
    return c.variables.filter(
      (v) => v.type === 'COLOR' && (!q || v.name.toLowerCase().includes(q))
    );
  };
  const any = () => props.collections.some((c) => colors(c).length > 0);
  return (
    <Show when={props.bound || (props.onBind && props.collections.length > 0)}>
      <div class="flex min-w-0 items-center gap-1">
        <Show when={props.bound}>
          {(bound) => (
            <span
              class="flex min-w-0 max-w-24 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-ink"
              title={bound().name}
              data-testid={`fig-variable-${props.kind}`}
            >
              <Hexagon class="size-3 shrink-0 text-ink-muted" />
              <span class="truncate">{splitStyleName(bound().name).leaf}</span>
            </span>
          )}
        </Show>
        <Show when={props.bound && props.onBind}>
          <button
            type="button"
            aria-label="Detach variable"
            title="Detach variable"
            class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            data-testid={`fig-variable-detach-${props.kind}`}
            onClick={() => props.onBind?.(undefined)}
          >
            <LinkBreak class="size-3.5" />
          </button>
        </Show>
        <Show when={props.onBind}>
          <Popover
            placement="left-start"
            gutter={40}
            open={open()}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setQuery('');
            }}
          >
            <Popover.Trigger
              aria-label="Color variables"
              title="Apply color variable"
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              data-testid={`fig-variable-picker-${props.kind}`}
            >
              <Hexagon class="size-3.5" />
            </Popover.Trigger>
            <Popover.Portal>
              <Layer depth={3}>
                <Popover.Content
                  class="z-modal flex max-h-96 w-60 flex-col rounded-xl border border-edge-muted bg-menu p-2 text-xs shadow-xl outline-none"
                  aria-label="Color variables"
                  onKeyDown={(e: KeyboardEvent) => {
                    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                  }}
                  onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                >
                  <input
                    class="mb-2 rounded-md bg-input px-2 py-1 text-ink outline-none placeholder:text-ink-placeholder"
                    placeholder="Search variables"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <div class="min-h-0 flex-1 overflow-y-auto">
                    <Show
                      when={any()}
                      fallback={
                        <p class="px-2 py-1 text-ink-muted">
                          No color variables.
                        </p>
                      }
                    >
                      <For each={props.collections}>
                        {(c) => (
                          <Show when={colors(c).length > 0}>
                            <div class="px-2 py-1 font-semibold text-ink-muted">
                              {c.name}
                            </div>
                            <For each={colors(c)}>
                              {(v) => (
                                <button
                                  type="button"
                                  class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ink hover:bg-hover"
                                  classList={{
                                    'bg-hover': v.id === props.bound?.id,
                                  }}
                                  data-testid="fig-variable-option"
                                  onClick={() => {
                                    setOpen(false);
                                    props.onBind?.(v.id);
                                  }}
                                >
                                  <ValuePreview value={v.values[0]} />
                                  <span class="truncate">{v.name}</span>
                                </button>
                              )}
                            </For>
                          </Show>
                        )}
                      </For>
                    </Show>
                  </div>
                </Popover.Content>
              </Layer>
            </Popover.Portal>
          </Popover>
        </Show>
      </div>
    </Show>
  );
}

/** A frame's variable modes, one menu per collection. */
export function VariableModes(props: {
  modes: readonly ModeChoice[];
  /** Absent when read-only. */
  onMode?: (collection: string, mode: string | undefined) => void;
}) {
  return (
    <Show when={props.modes.length > 0}>
      <Section title="Variable modes" testId="fig-variable-modes">
        <For each={props.modes}>
          {(m) => (
            <PropertyRow label={m.collection.name}>
              <select
                class="w-full rounded-md bg-inset px-1.5 py-0.5 text-ink outline-none disabled:opacity-60"
                value={m.mode ?? ''}
                disabled={!props.onMode}
                data-testid={`fig-variable-mode-${m.collection.name.replace(/\s+/g, '-')}`}
                onChange={(e) =>
                  props.onMode?.(
                    m.collection.id,
                    e.currentTarget.value || undefined
                  )
                }
              >
                <option value="">Auto</option>
                <For each={m.modes}>
                  {(mode) => <option value={mode.id}>{mode.name}</option>}
                </For>
              </select>
            </PropertyRow>
          )}
        </For>
      </Section>
    </Show>
  );
}

/** The file's variable collections, each with its variables per mode. */
export function VariablesList(props: {
  collections: readonly CollectionInfo[];
}) {
  return (
    <Show when={props.collections.some((c) => c.variables.length > 0)}>
      <Section title="Variables" testId="fig-variables">
        <For each={props.collections.filter((c) => c.variables.length > 0)}>
          {(c) => (
            <div
              class="flex flex-col gap-1"
              data-testid="fig-variable-collection"
            >
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-semibold text-ink">
                  {c.name}
                </span>
                <span
                  class="shrink-0 text-ink-muted"
                  title={c.modes.map((m) => m.name).join(', ')}
                >
                  {c.modes.length === 1
                    ? c.modes[0]?.name
                    : `${c.modes.length} modes`}
                </span>
              </div>
              <For each={c.variables}>
                {(v) => (
                  <div
                    class="flex min-w-0 items-center gap-2 pl-2"
                    data-testid="fig-variable"
                    data-variable-name={v.name}
                  >
                    <span
                      class="min-w-0 flex-1 truncate text-ink"
                      title={v.name}
                    >
                      {v.name}
                    </span>
                    <For each={v.values.slice(0, 4)}>
                      {(value) => <ValuePreview value={value} />}
                    </For>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Section>
    </Show>
  );
}
