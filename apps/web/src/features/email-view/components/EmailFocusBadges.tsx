import type { EmailFocus, EntityData } from '@entity';
import { Badge, cn, TagDot, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import type { EmailFocusSort } from '../constants';
import { emailFocusReason } from '../focus-reason';

/**
 * Focus rows stack below this list width, in px, where a reason beside the
 * subject would leave it only a few words.
 */
export const EMAIL_FOCUS_WIDE_BREAKPOINT = 640;

/** A Focus row's classification; other rows have none. */
const emailFocusOf = (entity: EntityData): EmailFocus | undefined =>
  entity.type === 'email' ? entity.focus : undefined;

/** Lit bars for each importance band, highest first. */
const IMPORTANCE_LEVELS = [
  { from: 80, lit: 5 },
  { from: 60, lit: 4 },
  { from: 40, lit: 3 },
  { from: 20, lit: 2 },
  { from: 5, lit: 1 },
  { from: 0, lit: 0 },
] as const;

const BARS = [0, 1, 2, 3, 4] as const;

/** The 0-100 importance score as five quiet bars; the value is in the label. */
function ImportanceMeter(props: { focus: EmailFocus }) {
  const label = () => `Importance ${props.focus.importance} of 100`;
  const lit = () =>
    IMPORTANCE_LEVELS.find((band) => props.focus.importance >= band.from)
      ?.lit ?? 0;
  return (
    <Tooltip as="span" label={label()} class="inline-flex shrink-0">
      <span role="img" aria-label={label()} class="flex items-center gap-0.5">
        <For each={BARS}>
          {(bar) => (
            <span
              class={cn(
                'h-3 w-1 rounded-full',
                bar < lit() ? 'bg-ink-extra-muted/60' : 'bg-ink-extra-muted/20'
              )}
            />
          )}
        </For>
      </span>
    </Tooltip>
  );
}

/**
 * A Focus row's importance meter, only while the list is sorted by importance:
 * there it explains the order, and elsewhere it only draws the eye.
 */
export function EmailFocusScore(props: {
  entity: EntityData;
  sort: EmailFocusSort;
}) {
  return (
    <Show when={props.sort === 'importance' && emailFocusOf(props.entity)}>
      {(focus) => <ImportanceMeter focus={focus()} />}
    </Show>
  );
}

/** Why a Focus row is on the list, drawn like a row's tag pills. */
export function EmailFocusReason(props: { entity: EntityData }) {
  const reason = () => {
    const focus = emailFocusOf(props.entity);
    return focus && emailFocusReason(focus);
  };
  return (
    <Show when={reason()}>
      {(shown) => (
        <Badge
          variant="outline"
          size="xs"
          class="select-none border-edge-button bg-control"
        >
          <TagDot size="sm" fill={shown().fill} />
          {shown().label}
        </Badge>
      )}
    </Show>
  );
}

/** Both on one line, for stacked rows, which have no metadata column. */
export function EmailFocusPreviewLeading(props: {
  entity: EntityData;
  sort: EmailFocusSort;
}) {
  return (
    <>
      <EmailFocusScore entity={props.entity} sort={props.sort} />
      <EmailFocusReason entity={props.entity} />
    </>
  );
}
