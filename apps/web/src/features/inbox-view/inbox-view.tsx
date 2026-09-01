import { ViewShell } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Suspense } from 'solid-js';
import { InboxHeader } from './components/InboxHeader';
import { InboxList } from './components/InboxList';
import { InboxTabs } from './components/InboxTabs';
import { InboxViewProvider, useInboxView } from './inbox-view-context';
import type { InboxViewStateOptions } from './types';

export type InboxViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: InboxViewStateOptions;
};

function InboxFallback() {
  return (
    <div class="grid min-h-0 min-w-0 flex-1 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading inbox" class="size-5 animate-spin" />
    </div>
  );
}

function InboxViewRoot() {
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useInboxView();

  createEffect(() => {
    if (state.tab !== 'reminders') return;

    setTab('signal');
  });

  onMount(() => panel.handle.setDisplayName('Inbox'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <ViewShell.Root aside={false} main={{ min: 224 }}>
              <ViewShell.Main>
                <InboxHeader>
                  <InboxTabs />
                </InboxHeader>
                <Suspense fallback={<InboxFallback />}>
                  <InboxList />
                </Suspense>
              </ViewShell.Main>
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/** Composable heterogeneous Inbox built on the shared view and Soup primitives. */
export function InboxView(props: InboxViewProps) {
  return (
    <InboxViewProvider initialState={props.initialState}>
      <InboxViewRoot />
    </InboxViewProvider>
  );
}
