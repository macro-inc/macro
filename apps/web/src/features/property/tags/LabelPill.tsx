import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import {
  badgeClasses,
  badgeTriggerClasses,
  cn,
  Dropdown,
  HoverCard,
  Layer,
} from '@ui';
import { For, Show } from 'solid-js';

/**
 * A label from the provider (a Gmail label or Outlook category) on a row: it
 * is read-only, unlike a tag.
 */
export type RowLabel = {
  id: string;
  /** What the row shows: a nested label's own name ("Larkspur"). */
  name: string;
  /** The whole name, for the hover card and menus ("Customers / Larkspur"). */
  fullName: string;
};

/** A label's icon, where a tag has its color dot. */
export function LabelIcon(props: { class?: string }) {
  return (
    <TagSimpleIcon class={cn('size-3 shrink-0 text-ink-muted', props.class)} />
  );
}

/** A read-only label drawn like a tag pill. */
export function LabelChip(props: {
  name: string;
  size?: 'xs' | 'sm';
  class?: string;
}) {
  return (
    <span
      class={badgeClasses({
        variant: 'outline',
        size: props.size ?? 'xs',
        class: cn(
          'min-w-0 gap-1.5 border-edge bg-surface-2 text-ink-muted',
          props.class
        ),
      })}
    >
      <LabelIcon />
      <span class="min-w-0 truncate">{props.name}</span>
    </span>
  );
}

/** A label on a row: its own name, and its whole name on hover. */
export function LabelPill(props: { label: RowLabel; class?: string }) {
  return (
    <Layer depth={2}>
      <HoverCard
        placement="bottom-start"
        content={
          <span class="flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-ink">
            <LabelIcon />
            <span class="min-w-0 max-w-[30ch] truncate">
              {props.label.fullName}
            </span>
          </span>
        }
      >
        <LabelChip name={props.label.name} class={props.class} />
      </HoverCard>
    </Layer>
  );
}

/**
 * A thread's labels as one pill beside its tags: a single label's own name,
 * or how many there are, opening a list of their whole names.
 */
export function LabelsMenuPill(props: { labels: readonly RowLabel[] }) {
  const face = () =>
    props.labels.length === 1
      ? props.labels[0].name
      : `${props.labels.length} Labels`;
  return (
    <Show when={props.labels.length > 0}>
      <Layer depth={2}>
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger
            as="button"
            type="button"
            class={badgeTriggerClasses({
              variant: 'outline',
              size: 'xs',
              class: 'min-w-0 max-w-35 gap-1.5 border-edge bg-surface-2',
            })}
          >
            <LabelIcon />
            <span class="min-w-0 truncate">{face()}</span>
            <CaretDownIcon class="size-3 shrink-0" />
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-48 max-w-80">
            <Dropdown.Group>
              <For each={props.labels}>
                {(label) => (
                  <Dropdown.Item>
                    <LabelIcon class="size-4" />
                    <span class="min-w-0 truncate">{label.fullName}</span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Layer>
    </Show>
  );
}
