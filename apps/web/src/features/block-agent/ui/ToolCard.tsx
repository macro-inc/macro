/**
 * A bare tool row with an icon, a compact result, and lazy result disclosure.
 *
 * Ported from opencode's
 * `packages/session-ui/src/v2/components/basic-tool-v2.tsx`
 * (github.com/sst/opencode, MIT © 2025 opencode), restyled to Macro's tokens
 * and the `Tool` card idiom.
 */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import Wrench from '@phosphor/wrench.svg';
import { Tooltip } from '@ui/components/Tooltip';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';
import { isToolActive, type ToolStatus } from './types';

export interface ToolCardProps {
  icon?: JSX.Element;
  title: JSX.Element | string;
  /** Mono, truncated detail next to the title (a path, a command, ...). */
  subtitle?: string;
  /** Compact `key=value` details after the subtitle. */
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
  /** Whether conditional children have content, without constructing them. */
  hasContent?: boolean;
  /** Expandable body. Without children the row has no collapse affordance. */
  children?: JSX.Element;
}

export function ToolCard(props: ToolCardProps) {
  const active = () => isToolActive(props.status);
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    props.defaultOpen ?? false
  );
  const open = () => props.open ?? uncontrolledOpen();
  const setOpen = (value: boolean) => {
    setUncontrolledOpen(value);
    props.onOpenChange?.(value);
  };
  // Reading children to inspect them mounts expensive bodies even while closed.
  // Conditional callers supply presence separately; Kobalte mounts the body.
  const hasChildren = () => props.hasContent ?? 'children' in props;
  const summary = () =>
    props.trailing ??
    (props.status === 'failed'
      ? 'Failed'
      : props.status === 'completed'
        ? 'Succeeded'
        : undefined);

  const row = (expandable: boolean) => (
    <>
      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted [&>svg]:size-4"
      >
        {props.icon ?? <Wrench />}
      </span>
      <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span class="min-w-0 truncate text-ink-muted">
          {typeof props.title === 'string' ? (
            <Tooltip
              label={props.title}
              as="span"
              class="min-w-0 max-w-full truncate"
            >
              <TextShimmer text={props.title} active={active()} />
            </Tooltip>
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
              <Tooltip label={subtitle()} as="span" class="min-w-0 truncate">
                <span class="truncate font-mono">{subtitle()}</span>
              </Tooltip>
            </>
          )}
        </Show>
        <For each={Object.entries(props.args ?? {})}>
          {([key, value]) => (
            <span class="min-w-0 truncate font-mono text-ink-extra-muted">
              {key}={value}
            </span>
          )}
        </For>
      </span>
      <Show when={summary() || expandable}>
        <span class="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-xs tabular-nums text-ink-extra-muted">
          {summary()}
          <Show when={expandable}>
            <CaretRight
              aria-hidden="true"
              class="size-3.5 shrink-0 text-ink-extra-muted group-data-expanded:rotate-90"
            />
          </Show>
        </span>
      </Show>
    </>
  );

  return (
    <div
      class="min-w-0 text-ink-extra-muted"
      data-tool-row
      data-tool-status={props.status}
      classList={{ 'opacity-75': props.muted }}
    >
      <Show
        when={hasChildren()}
        fallback={
          <div class="flex min-h-8 w-full min-w-0 items-center gap-2 py-1 text-left text-sm leading-6">
            {row(false)}
          </div>
        }
      >
        <Collapsible open={open()} onOpenChange={setOpen}>
          <Collapsible.Trigger class="group flex min-h-8 w-full min-w-0 items-center gap-2 py-1 text-left text-sm leading-6 outline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
            {row(true)}
          </Collapsible.Trigger>
          <Collapsible.Content class="data-closed:hidden">
            <Show when={open()}>
              <div class="min-w-0 pb-2 pl-6 text-xs leading-5">
                {props.children}
              </div>
            </Show>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  );
}
