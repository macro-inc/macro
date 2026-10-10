import type { EmailFocus, EmailFocusCategory, EntityData } from '@entity';
import { cn, Tooltip } from '@ui';
import { type ParentProps, Show } from 'solid-js';
import { match } from 'ts-pattern';

/** A Focus row's classification; other rows have none. */
export const emailFocusOf = (entity: EntityData): EmailFocus | undefined =>
  entity.type === 'email' ? entity.focus : undefined;

/** Categories worth naming on a row; the rest add nothing to a Focus row. */
const categoryLabel = (category: EmailFocusCategory): string | undefined =>
  match(category)
    .with('SECURITY', () => 'security')
    .with('CUSTOMER', () => 'customer')
    .with('TEAM', () => 'team')
    .otherwise(() => undefined);

/** The 0-100 importance score ahead of a Focus row's subject. */
export function EmailFocusScore(props: { focus: EmailFocus }) {
  const label = () => `Importance ${props.focus.importance} of 100`;
  return (
    <Tooltip as="span" label={label()} class="inline-flex shrink-0">
      <span
        role="img"
        aria-label={label()}
        class={cn(
          'inline-flex h-4 min-w-6 items-center justify-center rounded-full px-1 font-mono text-xxs font-medium tabular-nums',
          props.focus.importance >= 80
            ? 'bg-accent text-surface'
            : props.focus.importance >= 50
              ? 'bg-accent/15 text-accent'
              : 'border border-edge-muted text-ink-extra-muted'
        )}
      >
        {props.focus.importance}
      </span>
    </Tooltip>
  );
}

function FocusBadge(props: ParentProps<{ class: string }>) {
  return (
    <span
      class={cn(
        'inline-flex select-none items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xxs font-medium uppercase',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

/** Reply-needed, follow-up and category markers in a Focus row's metadata. */
export function EmailFocusFlags(props: { focus: EmailFocus }) {
  return (
    <>
      <Show when={props.focus.needsReply}>
        <FocusBadge class="text-warning border-warning/20">
          reply needed
        </FocusBadge>
      </Show>
      <Show when={props.focus.needsFollowUp}>
        <FocusBadge class="text-accent border-accent/20">follow up</FocusBadge>
      </Show>
      <Show when={categoryLabel(props.focus.category)}>
        {(label) => (
          <FocusBadge class="text-ink-extra-muted border-edge-muted">
            {label()}
          </FocusBadge>
        )}
      </Show>
    </>
  );
}
