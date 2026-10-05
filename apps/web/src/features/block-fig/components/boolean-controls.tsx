/**
 * Figma's boolean operations: icon buttons for the design panel (the
 * current operation of a boolean layer highlighted) and the toolbar's
 * menu, both with Flatten. Presentational.
 */

import { IS_MAC } from '@core/constant/isMac';
import Exclude from '@phosphor/exclude.svg';
import Intersect from '@phosphor/intersect.svg';
import StackSimple from '@phosphor/stack-simple.svg';
import Subtract from '@phosphor/subtract.svg';
import Unite from '@phosphor/unite.svg';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  BOOLEAN_ITEMS,
  type BooleanItem,
  type BooleanOperation,
} from '../core/boolean';

export function BooleanIcon(props: { item: BooleanItem; class?: string }) {
  return match(props.item.id)
    .with('union', () => <Unite class={props.class} />)
    .with('subtract', () => <Subtract class={props.class} />)
    .with('intersect', () => <Intersect class={props.class} />)
    .with('exclude', () => <Exclude class={props.class} />)
    .exhaustive();
}

const shortcut = (item: BooleanItem) => `⌥⇧${item.key}`;
const flattenShortcut = IS_MAC ? '⌘E' : 'Ctrl+E';

/** The design panel's row: the four operations and Flatten. */
export function BooleanButtons(props: {
  /** A selected boolean layer's operation, shown as chosen. */
  current?: BooleanOperation | null;
  onBoolean: (operation: BooleanOperation) => void;
  onFlatten: () => void;
}) {
  return (
    <div
      class="flex items-center gap-0.5 border-edge-muted border-b px-2 py-1.5"
      data-testid="fig-boolean-row"
    >
      <For each={BOOLEAN_ITEMS}>
        {(item) => (
          <button
            type="button"
            aria-label={item.label}
            aria-pressed={props.current === item.operation}
            title={`${item.label} · ${shortcut(item)}`}
            data-testid={`fig-boolean-${item.id}`}
            class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
            classList={{
              'bg-accent/15 text-accent': props.current === item.operation,
            }}
            onClick={() => props.onBoolean(item.operation)}
          >
            <BooleanIcon item={item} class="size-4" />
          </button>
        )}
      </For>
      <div aria-hidden="true" class="mx-1 h-4 w-px bg-edge-muted" />
      <button
        type="button"
        aria-label="Flatten"
        title={`Flatten · ${flattenShortcut}`}
        data-testid="fig-flatten"
        class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
        onClick={() => props.onFlatten()}
      >
        <StackSimple class="size-4" />
      </button>
    </div>
  );
}

/** The toolbar menu's items, as Figma lists them. */
export function BooleanMenuItems(props: {
  onBoolean: (operation: BooleanOperation) => void;
  onFlatten: () => void;
  /** Closes the menu after a choice. */
  onDone: () => void;
}) {
  const Item = (p: {
    label: string;
    shortcut: string;
    testId: string;
    icon: JSX.Element;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      data-testid={p.testId}
      class="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-hover"
      onClick={() => {
        p.onSelect();
        props.onDone();
      }}
    >
      {p.icon}
      <span class="flex-1">{p.label}</span>
      <Show when={p.shortcut}>
        <span class="text-ink-muted">{p.shortcut}</span>
      </Show>
    </button>
  );
  return (
    <>
      <For each={BOOLEAN_ITEMS}>
        {(item) => (
          <Item
            label={item.label}
            shortcut={shortcut(item)}
            testId={`fig-menu-boolean-${item.id}`}
            icon={<BooleanIcon item={item} class="size-4" />}
            onSelect={() => props.onBoolean(item.operation)}
          />
        )}
      </For>
      <div class="my-1 h-px bg-edge-muted" />
      <Item
        label="Flatten"
        shortcut={flattenShortcut}
        testId="fig-menu-flatten"
        icon={<StackSimple class="size-4" />}
        onSelect={props.onFlatten}
      />
    </>
  );
}
