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
import Wrench from '@phosphor/wrench.svg';
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
  /** Tool-specific icon in the activity row. */
  icon?: JSX.Element;
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
  'flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] leading-5';

export function ToolCard(props: ToolCardProps) {
  const active = () => isToolActive(props.status);
  const resolved = resolveChildren(() => props.children);
  const hasChildren = createMemo(() => {
    const body = resolved();
    return Array.isArray(body) ? body.length > 0 : body != null;
  });

  const row = (expandable: boolean) => (
    <>
      <span
        aria-hidden="true"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted"
        classList={{
          'text-accent bg-accent/8': active(),
          'text-failure': props.status === 'failed',
        }}
      >
        {props.icon ?? <Wrench class="size-4" />}
      </span>
      <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span class="min-w-0 shrink truncate text-ink-muted">
          {typeof props.title === 'string' ? (
            <TextShimmer
              text={props.title
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/_/g, ' ')}
              active={active()}
            />
          ) : (
            props.title
          )}
        </span>
        <Show when={props.subtitle}>
          {(subtitle) => (
            <>
              <span
                title={subtitle()}
                class="min-w-0 truncate rounded-md border border-edge-muted bg-ink/4 px-2 py-0.5 text-xs text-ink-muted"
              >
                {subtitle()}
              </span>
            </>
          )}
        </Show>
        <For each={Object.entries(props.args ?? {})}>
          {([key, value]) => (
            <span class="shrink-0 rounded-md bg-ink/4 px-1.5 font-mono text-xs text-ink-extra-muted">
              {key}={value}
            </span>
          )}
        </For>
      </span>
      <Show when={expandable}>
        <CaretRight
          aria-hidden="true"
          class="size-3.5 shrink-0 text-ink-extra-muted transition-transform duration-150 group-data-expanded:rotate-90 motion-reduce:transition-none"
        />
      </Show>
      <Show when={active()}>
        <span class="shrink-0 text-[11px] text-ink-extra-muted">
          {props.status === 'pending' ? 'Pending' : 'Running'}
        </span>
      </Show>
      <Show when={props.trailing}>
        <span class="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-ink/5 px-2 py-0.5 whitespace-nowrap text-[11px]">
          {props.trailing}
        </span>
      </Show>
    </>
  );

  return (
    <div
      class="min-w-0 text-ink-muted"
      classList={{ 'text-ink-subtle': props.muted }}
    >
      <Show
        when={hasChildren()}
        fallback={<div class={ROW_CLASS}>{row(false)}</div>}
      >
        <Collapsible
          open={props.open}
          defaultOpen={props.defaultOpen}
          onOpenChange={props.onOpenChange}
          class="overflow-hidden rounded-xl border border-transparent data-expanded:border-edge-muted data-expanded:bg-ink/2"
        >
          <Collapsible.Trigger
            class={`group transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${ROW_CLASS}`}
          >
            {row(true)}
          </Collapsible.Trigger>
          <Collapsible.Content class="data-closed:hidden">
            <div class="min-w-0 overflow-hidden border-t border-edge-muted">
              {resolved()}
            </div>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  );
}
