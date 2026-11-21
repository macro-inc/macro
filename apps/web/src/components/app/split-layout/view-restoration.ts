import { type Entry, usePane, useSplitRouter } from '@app/lib/split-router';
import { createComputed, on, onCleanup, useContext } from 'solid-js';
import { SplitLayoutContext } from './context';
import { useSplitPanelOrThrow } from './layoutUtils';
import { splitContentFromLocation } from './split-router/legacy-route';
import { viewRestorationKey } from './view-restoration-key';
import type { RetainedViewState } from './view-state';

/** Opt this view into resuming its last location and captured entry-state slices. */
export function useViewRestoration(key?: string): void {
  const layout = useContext(SplitLayoutContext);
  if (!layout) throw new Error('View restoration requires SplitLayoutProvider');
  const { handle } = useSplitPanelOrThrow();
  const pane = usePane();
  const router = useSplitRouter();
  const entry = () => router.entry(pane());
  if (!entry()) throw new Error('View restoration requires a router entry');
  function capture(entry: Entry): RetainedViewState | undefined {
    const content = handle.content();
    if (content.type !== 'component') return;
    handle.captureEntryState();
    return {
      location: entry.location,
      routeState: entry.state,
      entryState: handle.currentEntryState(),
      params: content.preserveParams ? content.params : undefined,
      preserveParams: content.preserveParams,
    };
  }

  let retention:
    | ReturnType<typeof layout.manager.viewState.register>
    | undefined;
  let registeredKey: string | undefined;
  createComputed(
    on(entry, (current) => {
      const id = current
        ? (key ??
          viewRestorationKey(
            splitContentFromLocation(current.location).id,
            current.location
          ))
        : undefined;
      if (id !== registeredKey) {
        retention?.dispose();
        retention = id
          ? layout.manager.viewState.register(id, handle.id, entry, capture)
          : undefined;
        registeredKey = id;
      }
    })
  );
  onCleanup(() => retention?.dispose());
  // Descendant navigation can switch Tasks and Projects without unmounting
  // this workspace. Capture its old entry before any such navigation commits.
  onCleanup(
    router.registerGuard(
      pane(),
      Number.MAX_SAFE_INTEGER,
      ({ from, onCommit }) => {
        const publish = retention?.remember(from);
        if (publish) onCommit(publish);
        return true;
      },
      { search: ['tasks', 'projects'] }
    )
  );
}
