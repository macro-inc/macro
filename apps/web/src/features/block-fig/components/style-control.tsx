/**
 * Shared styles in the fill, stroke, text, and effect sections: the style
 * a layer uses (with "Detach style"), and a picker listing the file's
 * styles of that kind by folder, with "Create style" from the layer's
 * values. Presentational: data and actions come in as props.
 */

import type { NodeRef, StyleInfo } from '@core/fig-engine/design-types';
import { Popover } from '@kobalte/core/popover';
import LinkBreak from '@phosphor/link-break.svg';
import Sparkle from '@phosphor/sparkle.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import { Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  groupStyles,
  type StyleKind,
  splitStyleName,
  styleTypeFor,
} from '../core/design-system';
import { paintSwatch } from './paint-controls';

/** A small preview of a style: its color, "Ag" for text, a sparkle. */
export function StylePreview(props: { style: StyleInfo | undefined }) {
  const paint = () => props.style?.paints.find((p) => p.visible);
  return (
    <Show
      when={props.style?.type === 'FILL'}
      fallback={
        <Show
          when={props.style?.type === 'TEXT'}
          fallback={<Sparkle class="size-3.5 shrink-0 text-ink-muted" />}
        >
          <span class="w-4 shrink-0 text-center font-semibold text-ink">
            Ag
          </span>
        </Show>
      }
    >
      <span
        class="size-3.5 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: paint() ? paintSwatch(paint()!) : 'transparent' }}
      />
    </Show>
  );
}

const KIND_NAMES: Record<StyleKind, string> = {
  FILL: 'fill',
  STROKE: 'stroke',
  TEXT: 'text',
  EFFECT: 'effect',
};

export function StyleControl(props: {
  kind: StyleKind;
  applied: NodeRef | null;
  styles: readonly StyleInfo[];
  /** Absent when read-only. */
  onApply?: (style: string | undefined) => void;
  onCreate?: (name: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [name, setName] = createSignal('');
  const kind = () => KIND_NAMES[props.kind];
  const groups = () =>
    groupStyles(props.styles, styleTypeFor(props.kind), query());
  const appliedStyle = () =>
    props.styles.find((s) => s.id === props.applied?.id);
  const close = () => {
    setOpen(false);
    setQuery('');
    setName('');
  };
  const create = () => {
    const n = name().trim();
    if (!n) return;
    close();
    props.onCreate?.(n);
  };
  return (
    <div class="flex min-w-0 items-center gap-1">
      <Show when={props.applied}>
        {(applied) => (
          <span
            class="flex min-w-0 max-w-28 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-ink"
            title={applied().name}
            data-testid={`fig-style-${props.kind}`}
          >
            <StylePreview style={appliedStyle()} />
            <span class="truncate">{splitStyleName(applied().name).leaf}</span>
          </span>
        )}
      </Show>
      <Show when={props.applied && props.onApply}>
        <button
          type="button"
          aria-label="Detach style"
          title="Detach style"
          class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
          data-testid={`fig-style-detach-${props.kind}`}
          onClick={() => props.onApply?.(undefined)}
        >
          <LinkBreak class="size-3.5" />
        </button>
      </Show>
      <Show when={props.onApply}>
        <Popover
          placement="left-start"
          gutter={40}
          open={open()}
          onOpenChange={(o) => (o ? setOpen(true) : close())}
        >
          <Popover.Trigger
            aria-label={`${kind()} styles`}
            title={`Apply ${kind()} style`}
            class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            data-testid={`fig-style-picker-${props.kind}`}
          >
            <SquaresFour class="size-3.5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Layer depth={3}>
              <Popover.Content
                class="fig-editor-theme z-modal flex max-h-96 w-60 flex-col rounded-xl border border-edge-muted bg-menu p-2 text-xs shadow-xl outline-none"
                aria-label={`${kind()} styles`}
                data-testid="fig-style-popover"
                onKeyDown={(e: KeyboardEvent) => {
                  if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                }}
                onPointerDown={(e: PointerEvent) => e.stopPropagation()}
              >
                <input
                  class="mb-2 rounded-md bg-input px-2 py-1 text-ink outline-none placeholder:text-ink-placeholder"
                  placeholder="Search styles"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <div class="min-h-0 flex-1 overflow-y-auto">
                  <For
                    each={groups()}
                    fallback={
                      <p class="px-2 py-1 text-ink-muted">
                        No {kind() === 'stroke' ? 'color' : kind()} styles yet.
                      </p>
                    }
                  >
                    {(g) => (
                      <div class="py-0.5">
                        <Show when={g.folder}>
                          <div class="px-2 py-1 font-semibold text-ink-muted">
                            {g.folder}
                          </div>
                        </Show>
                        <For each={g.styles}>
                          {(s) => (
                            <button
                              type="button"
                              class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ink hover:bg-hover"
                              classList={{
                                'bg-hover': s.id === props.applied?.id,
                              }}
                              title={s.description ?? s.name}
                              data-testid="fig-style-option"
                              onClick={() => {
                                close();
                                props.onApply?.(s.id);
                              }}
                            >
                              <StylePreview style={s} />
                              <span class="truncate">
                                {splitStyleName(s.name).leaf}
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={props.onCreate}>
                  <div class="mt-2 flex gap-1 border-edge-muted border-t pt-2">
                    <input
                      class="min-w-0 flex-1 rounded-md bg-input px-2 py-1 text-ink outline-none placeholder:text-ink-placeholder"
                      placeholder="New style name"
                      data-testid="fig-style-create-name"
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') create();
                      }}
                    />
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-ink hover:bg-hover disabled:opacity-40"
                      disabled={!name().trim()}
                      data-testid="fig-style-create"
                      onClick={create}
                    >
                      Create
                    </button>
                  </div>
                </Show>
              </Popover.Content>
            </Layer>
          </Popover.Portal>
        </Popover>
      </Show>
    </div>
  );
}
