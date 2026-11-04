import { type PaneId, useSplitRouter } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createEffect, on, onCleanup, untrack } from 'solid-js';
import {
  createMobileSearchSession,
  type MobileSearchSnapshot,
  SearchState,
} from './mobileSearchState';

/** Bind chrome to this entry only while it is foregrounded, without focusing it. */
export function createMobileSearchEntry() {
  const { handle } = useSplitPanelOrThrow();
  const router = useSplitRouter();
  const currentEntry = () => router.entry(handle.id as string as PaneId);
  const entryId = untrack(() => currentEntry()?.id);
  const stored = untrack(
    () => handle.currentEntryState()?.['mobileSearch.session']
  ) as MobileSearchSnapshot | undefined;
  const session = stored
    ? createMobileSearchSession(stored)
    : untrack(() =>
        SearchState.isOpen()
          ? SearchState.session()
          : createMobileSearchSession()
      );
  const dispose = handle.registerEntryStateCaptor(
    'mobileSearch.session',
    session.snapshot
  );
  createEffect(
    on([handle.isActive, () => currentEntry()?.id], ([active, currentId]) => {
      // Pane activation can precede outlet teardown during history changes.
      // A departing view must never bind or capture into the arriving entry.
      if (currentId !== entryId) return;
      if (active) {
        SearchState.resume(session);
      } else {
        // Native stacks only mount the front two panes. Capture before a
        // later entity can push this covered Search out of those slots.
        handle.captureEntryState();
        SearchState.suspend(session);
      }
    })
  );
  onCleanup(() => {
    dispose();
    SearchState.suspend(session);
  });
  return session;
}
