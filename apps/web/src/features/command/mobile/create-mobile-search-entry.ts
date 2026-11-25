import type { SearchOperatorBinding } from '@app/features/next-soup/core/search-operators';
import { type PaneId, useSplitRouter } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createEffect, on, onCleanup, untrack } from 'solid-js';
import {
  createMobileSearchSession,
  type MobileSearchSnapshot,
  SearchState,
} from './mobileSearchState';

type SearchOpener = { query: string; bindings: SearchOperatorBinding[] };

/**
 * What the entry was opened to search: a tag's entry state, or the route
 * params the universal input and Cmd+K open Search with, as on desktop.
 */
function openerSearch(
  state: Record<string, unknown> | undefined,
  params: Record<string, unknown> | undefined
): SearchOpener | undefined {
  const text = state?.['search.text'];
  if (typeof text === 'string' && text.trim())
    return {
      query: text,
      bindings: (state?.['search.bindings'] as SearchOperatorBinding[]) ?? [],
    };
  const query = params?.initialQuery;
  if (typeof query === 'string' && query.trim())
    return {
      query,
      bindings: (params?.initialBindings as SearchOperatorBinding[]) ?? [],
    };
}

/** Bind chrome to this entry only while it is foregrounded, without focusing it. */
export function createMobileSearchEntry() {
  const { handle } = useSplitPanelOrThrow();
  const router = useSplitRouter();
  const currentEntry = () => router.entry(handle.id as string as PaneId);
  const entryId = untrack(() => currentEntry()?.id);
  const stored = untrack(
    () => handle.currentEntryState()?.['mobileSearch.session']
  ) as MobileSearchSnapshot | undefined;
  const opener = untrack(() => {
    const content = handle.content();
    return openerSearch(
      handle.currentEntryState(),
      content.type === 'component'
        ? (content.params as Record<string, unknown> | undefined)
        : undefined
    );
  });
  const session = stored
    ? createMobileSearchSession(stored)
    : opener
      ? createMobileSearchSession({
          query: opener.query,
          bindings: opener.bindings,
          mode: 'name',
          universalInputActive: false,
        })
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
