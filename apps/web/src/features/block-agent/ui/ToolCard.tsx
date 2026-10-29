/**
 * A bare tool row, a compact result, and lazy result disclosure, shaped like
 * the session's other activity rows: the label, its detail beside it in a
 * dimmer tone, and a caret after them on hover. No icon and no indent, so a
 * run of calls reads as a quiet list in line with the prose around it.
 *
 * Ported from opencode's
 * `packages/session-ui/src/v2/components/basic-tool-v2.tsx`
 * (github.com/sst/opencode, MIT © 2025 opencode), restyled to Macro's tokens
 * and the `Tool` card idiom.
 */

import { Collapsible } from '@kobalte/core/collapsible';
import { Tooltip } from '@ui/components/Tooltip';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { DisclosureCaret } from './DisclosureCaret';
import { TextShimmer } from './TextShimmer';
import { isToolActive, type ToolStatus } from './types';

export interface ToolCardProps {
  title: JSX.Element | string;
  /** Mono, truncated detail next to the title (a path, a command, ...). */
  subtitle?: string;
  /** Compact `key=value` details after the subtitle. */
  args?: Record<string, string>;
  /** Status text or counts after the detail; a failed call says so by default. */
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
    props.trailing ?? (props.status === 'failed' ? 'Failed' : undefined);

  const row = (expandable: boolean) => (
    <>
      <span class="min-w-0 max-w-full shrink-0 truncate">
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
          <Tooltip
            label={subtitle()}
            as="span"
            class="min-w-0 truncate text-ink-disabled"
          >
            {subtitle()}
          </Tooltip>
        )}
      </Show>
      <For each={Object.entries(props.args ?? {})}>
        {([key, value]) => (
          <span class="min-w-0 truncate text-ink-disabled">
            {key}={value}
          </span>
        )}
      </For>
      <Show when={summary()}>
        <span
          class="shrink-0 whitespace-nowrap tabular-nums"
          classList={{
            'text-failure': props.status === 'failed',
            'text-ink-disabled': props.status !== 'failed',
          }}
        >
          {summary()}
        </span>
      </Show>
      <Show when={expandable}>
        <DisclosureCaret open={open()} />
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
          <div class="flex min-h-8 w-full min-w-0 items-center gap-1.5 py-1 text-left text-sm leading-6">
            {row(false)}
          </div>
        }
      >
        <Collapsible open={open()} onOpenChange={setOpen}>
          <Collapsible.Trigger class="group flex min-h-8 w-full min-w-0 items-center gap-1.5 py-1 text-left text-sm leading-6 outline-offset-2 not-touch:hover:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">
            {row(true)}
          </Collapsible.Trigger>
          <Collapsible.Content class="data-closed:hidden">
            <Show when={open()}>
              <div class="min-w-0 pb-2 text-xs leading-5">{props.children}</div>
            </Show>
          </Collapsible.Content>
        </Collapsible>
      </Show>
    </div>
  );
}
