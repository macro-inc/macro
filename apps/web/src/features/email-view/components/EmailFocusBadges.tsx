import type { EmailFocus, EntityData } from '@entity';
import { Badge, cn, TagDot, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { EmailFocusSort } from '../constants';
import { emailFocusDue } from '../focus-due';
import { emailFocusReason } from '../focus-reason';

/**
 * Focus rows stack below this list width, in px, where a reason and a due date
 * beside the subject, with the importance meter, would leave it only a few words.
 */
export const EMAIL_FOCUS_WIDE_BREAKPOINT = 720;

/** A Focus row's classification; other rows have none. */
const emailFocusOf = (entity: EntityData): EmailFocus | undefined =>
  entity.type === 'email' ? entity.focus : undefined;

/** Lit bars for each importance band, highest first. */
const IMPORTANCE_LEVELS = [
  { from: 80, lit: 5, color: 'bg-green' },
  { from: 60, lit: 4, color: 'bg-lime' },
  { from: 40, lit: 3, color: 'bg-yellow' },
  { from: 20, lit: 2, color: 'bg-orange' },
  { from: 5, lit: 1, color: 'bg-red' },
  { from: 0, lit: 0, color: '' },
] as const;

const BARS = [0, 1, 2, 3, 4] as const;

/**
 * Which way a row's importance is moving, if it is. A trend this build doesn't
 * know reads as flat, since the server ships separately.
 */
const importanceDirection = (trend: EmailFocus['importanceTrend']) =>
  match(trend)
    .returnType<'rising' | 'falling' | undefined>()
    .with('UP', () => 'rising')
    .with('DOWN', () => 'falling')
    .with('FLAT', () => undefined)
    .exhaustive(() => undefined);

/**
 * The 0-100 importance score as a number and a five-bar meter, with which way it
 * is moving, if it is, in the label.
 */
function ImportanceMeter(props: { focus: EmailFocus }) {
  const direction = () => importanceDirection(props.focus.importanceTrend);
  const label = () => {
    const score = `Importance ${props.focus.importance} of 100`;
    return direction() ? `${score}, ${direction()}` : score;
  };
  const level = () =>
    IMPORTANCE_LEVELS.find((band) => props.focus.importance >= band.from) ??
    IMPORTANCE_LEVELS[IMPORTANCE_LEVELS.length - 1];
  return (
    <Tooltip as="span" label={label()} class="inline-flex shrink-0">
      <span role="img" aria-label={label()} class="flex items-center gap-2">
        <span class="w-[3ch] text-right text-xs font-medium tabular-nums text-ink-muted">
          {props.focus.importance}
        </span>
        <span class="flex items-center gap-[3px]">
          <For each={BARS}>
            {(bar) => (
              <span
                class={cn(
                  'h-3.5 w-1.5 rounded-full',
                  bar < level().lit ? level().color : 'bg-ink-extra-muted/25'
                )}
              />
            )}
          </For>
        </span>
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

/** The day a Focus row's mail says it is due, the full date in its tooltip. */
function EmailFocusDue(props: { entity: EntityData }) {
  const due = () => {
    const dueOn = emailFocusOf(props.entity)?.dueOn;
    return dueOn ? emailFocusDue(dueOn, new Date()) : undefined;
  };
  return (
    <Show when={due()}>
      {(shown) => (
        <Tooltip as="span" label={shown().title} class="inline-flex shrink-0">
          <Badge
            variant="outline"
            size="xs"
            class={cn(
              'select-none bg-control',
              shown().overdue ? 'border-warning/40' : 'border-edge-button'
            )}
          >
            {/* Amber text is too faint on the light theme, so the dot carries it. */}
            <Show when={shown().overdue}>
              <TagDot size="sm" fill="var(--color-warning)" />
            </Show>
            {shown().label}
          </Badge>
        </Tooltip>
      )}
    </Show>
  );
}

/**
 * Why a Focus row is on the list and when it is due, drawn like a row's tag
 * pills. Stacked rows show these through `EmailFocusPreviewLeading`.
 */
export function EmailFocusReason(props: { entity: EntityData }) {
  const reason = () => {
    const focus = emailFocusOf(props.entity);
    return focus && emailFocusReason(focus);
  };
  return (
    <>
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
      <EmailFocusDue entity={props.entity} />
    </>
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
