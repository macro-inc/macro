/**
 * The universal collapsible tool card: one row per tool call, with an optional
 * expandable body.
 *
 * Ported from opencode's
 * `packages/session-ui/src/v2/components/basic-tool-v2.tsx`
 * (github.com/sst/opencode, MIT © 2025 opencode), restyled to Macro's tokens
 * and the `Tool` card idiom.
 */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import {
  createMemo,
  For,
  type JSX,
  children as resolveChildren,
  Show,
} from 'solid-js';
import { TextShimmer } from './TextShimmer';
import { isToolActive, type ToolStatus } from './types';

export interface ToolCardProps {
  title: JSX.Element | string;
  /** Mono, truncated detail next to the title (a path, a command, ...). */
  subtitle?: string;
  /** Small `key=value` chips after the subtitle. */
  args?: Record<string, string>;
  /** Right-aligned slot before the chevron (status text, counts, ...). */
  trailing?: JSX.Element;
  status: ToolStatus;
  /** Fade the whole card, the chat block's failed-tool treatment. */
  muted?: boolean;
  /** Controlled open state; omit to let the card manage its own. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Expandable body. Without children the row has no collapse affordance. */
  children?: JSX.Element;
}

const ROW_CLASS =
  'flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-xs leading-5';

export function ToolCard(props: ToolCardProps) {
  const active = () => isToolActive(props.status);
  const resolved = resolveChildren(() => props.children);
  const hasChildren = createMemo(() => {
    const body = resolved();
    return Array.isArray(body) ? body.length > 0 : body != null;
  });

  const row = (expandable: boolean) => (
    <>
      <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span class="shrink-0 text-ink">
          {typeof props.title === 'string' ? (
            <TextShimmer text={props.title} active={active()} />
          ) : (
            props.title
          )}
        </span>
        <Show when={props.subtitle}>
          {(subtitle) => (
            <>
              <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
                ·
              </span>
              <span class="min-w-0 truncate font-mono">{subtitle()}</span>
            </>
          )}
        </Show>
        <For each={Object.entries(props.args ?? {})}>
          {([key, value]) => (
            <span class="shrink-0 rounded bg-hover px-1 font-mono text-ink-extra-muted">
              {key}={value}
            </span>
          )}
        </For>
      </span>
      <Show when={props.trailing || expandable}>
        <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          {props.trailing}
          <Show when={expandable}>
            <CaretRight
              aria-hidden="true"
              class="size-3 shrink-0 text-ink-extra-muted transition-transform group-data-expanded:rotate-90 motion-reduce:transition-none"
            />
          </Show>
        </span>
      </Show>
    </>
  );

  return (
    <div
      class="overflow-hidden rounded-lg bg-surface text-ink-extra-muted"
      classList={{ 'opacity-50': props.muted }}
    >
      <Show
        when={hasChildren()}
        fallback={<div class={ROW_CLASS}>{row(false)}</div>}
      >
        <Collapsible
          open={props.open}
          defaultOpen={props.defaultOpen}
          onOpenChange={props.onOpenChange}
        >
          <Collapsible.Trigger class={`group hover:bg-hover ${ROW_CLASS}`}>
            {row(true)}
          </Collapsible.Trigger>
          <Collapsible.Content class="data-closed:hidden">
            <div class="min-w-0 px-3 pb-2">{resolved()}</div>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  );
}
