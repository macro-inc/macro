import type { EmailFocus, EntityData } from '@entity';
import { useListLayout } from '@entity/composed/list-entity/shared';
import { Badge, cn, TagDot, Tooltip } from '@ui';
import { For, type ParentProps, Show } from 'solid-js';

/** A Focus row's classification; other rows have none. */
export const emailFocusOf = (entity: EntityData): EmailFocus | undefined =>
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

/** The 0-100 importance score as a number and a five-bar meter. */
function ImportanceMeter(props: { focus: EmailFocus }) {
  const label = () => `Importance ${props.focus.importance} of 100`;
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

/** The score at the end of a wide Focus row, after the labels and tags. */
export function EmailFocusScore(props: { focus: EmailFocus }) {
  return <ImportanceMeter focus={props.focus} />;
}

/** The score ahead of the subject in narrow rows, which have no metadata column. */
export function EmailFocusNarrowScore(props: { focus: EmailFocus }) {
  const listLayout = useListLayout();
  return (
    <Show when={!(listLayout?.isWide() ?? true)}>
      <ImportanceMeter focus={props.focus} />
    </Show>
  );
}

/**
 * Dot color per label. Follow up is blue, not the accent: the accent can be
 * orange, which reads as Reply needed's amber beside it.
 */
const LABEL_TONES = {
  warning: 'var(--color-warning)',
  blue: 'var(--color-blue)',
} as const;

type LabelTone = keyof typeof LABEL_TONES;

/**
 * A read-only label drawn like a row's tag pills (`tagPillClasses`). Rows
 * under 56rem leave the room to the subject; the filter menu still finds them.
 */
function FocusLabel(props: ParentProps<{ tone: LabelTone }>) {
  return (
    <Badge
      variant="outline"
      size="sm"
      class="hidden select-none border-edge-button bg-control @4xl/entity:inline-flex"
    >
      <TagDot size="sm" fill={LABEL_TONES[props.tone]} />
      {props.children}
    </Badge>
  );
}

/** Reply-needed and follow-up labels in a Focus row's metadata. */
export function EmailFocusFlags(props: { focus: EmailFocus }) {
  return (
    <>
      <Show when={props.focus.needsReply}>
        <FocusLabel tone="warning">Reply needed</FocusLabel>
      </Show>
      <Show when={props.focus.needsFollowUp}>
        <FocusLabel tone="blue">Follow up</FocusLabel>
      </Show>
    </>
  );
}
