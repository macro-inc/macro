import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import {
  type Entry,
  useBeforeLeave,
  usePane,
  useSplitRouter,
} from '@app/lib/split-router';
import { onCleanup, untrack, useContext } from 'solid-js';
import { SplitLayoutContext } from './context';
import { useSplitPanelOrThrow } from './layoutUtils';
import { splitContentFromLocation } from './split-router/legacy-route';
import type { RetainedViewState } from './view-state';

/** Opt this view into resuming its last location and captured entry-state slices. */
export function useViewRestoration(key?: string): void {
  const layout = useContext(SplitLayoutContext);
  if (!layout) throw new Error('View restoration requires SplitLayoutProvider');
  const { handle } = useSplitPanelOrThrow();
  const pane = usePane();
  const router = useSplitRouter();
  const entry = () => router.entry(pane());
  const viewId =
    key ??
    untrack(() => {
      const current = entry();
      if (!current) throw new Error('View restoration requires a router entry');
      const content = splitContentFromLocation(current.location);
      return parseAgentsRoute(content.id) ? 'agents' : content.id;
    });

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

  const retention = layout.manager.viewState.register(
    viewId,
    handle.id,
    entry,
    capture
  );
  onCleanup(retention.dispose);
  useBeforeLeave(({ from, onCommit }) => {
    const publish = retention.remember(from);
    if (publish) onCommit(publish);
    return true;
  });
}
