import { globalSplitManager } from '@app/signal/splitLayout';
import type { ComposeTaskProps } from '@block-md/component/ComposeTask';
import type { SplitId } from '@components/app/split-layout/layoutManager';
import { ReactiveMap } from '@solid-primitives/map';
import type { Accessor } from 'solid-js';
import type { CreatableBlock } from './types';

/** How a destination's task composer creates the task and shows where it goes. */
export type DestinationTaskComposer = Pick<
  ComposeTaskProps,
  'createTask' | 'leadingChip'
>;

/**
 * Where the create menu puts a new task while a split shows a container for
 * one. A project registers itself, so `c` then `t` inside a project adds the
 * task to it — just as cmd+k offers the focused split's own commands. Only the
 * Task entry is placed; every other entry creates as it does anywhere else.
 */
export type CreateDestination = {
  /** Names the destination in the create menus. */
  label: string;
  taskComposer: DestinationTaskComposer;
};

const destinations = new ReactiveMap<
  SplitId,
  Accessor<CreateDestination | undefined>
>();

/**
 * Offer a destination for as long as the split shows it. The accessor can
 * withdraw it (e.g. while the viewer cannot add to it) by returning undefined;
 * pass a memo, as the menus read it on every render.
 */
export function registerCreateDestination(
  splitId: SplitId,
  destination: Accessor<CreateDestination | undefined>
): () => void {
  destinations.set(splitId, destination);
  return () => {
    if (destinations.get(splitId) === destination) destinations.delete(splitId);
  };
}

/**
 * The destination of the split the user is working in. That is the active
 * split, which keeps its place while focus moves into the create menu, the
 * command menu, or the sidebar.
 */
export function activeCreateDestination(): CreateDestination | undefined {
  const splitId = globalSplitManager()?.activeSplitId();
  return splitId ? destinations.get(splitId)?.() : undefined;
}

/** Secondary text for a create-menu entry: where it creates, else its hint. */
export function createMenuHint(
  item: Pick<CreatableBlock, 'destinationHint' | 'launcherHint'>
): string | undefined {
  return item.destinationHint?.() ?? item.launcherHint;
}
