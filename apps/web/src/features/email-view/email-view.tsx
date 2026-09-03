import { ViewShell } from '@app/components/view-shell';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Surface } from '@ui';
import { createSignal, onMount, Suspense } from 'solid-js';
import { EmailHeader } from './components/EmailHeader';
import { EmailList } from './components/EmailList';
import { EmailSidebar } from './components/EmailSidebar';
import { EmailViewProvider } from './email-view-context';
import type { EmailViewStateOptions } from './types';

export type EmailViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: EmailViewStateOptions;
};

function EmailListFallback() {
  return (
    <Surface
      depth={2}
      class="grid min-h-0 min-w-0 place-items-center rounded-2xl text-ink-muted"
    >
      <SpinnerIcon aria-label="Loading email" class="size-5 animate-spin" />
    </Surface>
  );
}

function EmailViewRoot() {
  const panel = useSplitPanelOrThrow();
  const [listElement, setListElement] = createSignal<HTMLDivElement>();

  onMount(() => panel.handle.setDisplayName('Email'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <ViewShell.Root
              resizable
              aside={{ preserveDuringResize: false }}
              main={{ preferredWidth: 640 }}
            >
              <ViewShell.Aside>
                <EmailSidebar />
              </ViewShell.Aside>
              <ViewShell.Main>
                <ViewShell.Header>
                  <EmailHeader onSearchEscape={() => listElement()?.focus()} />
                </ViewShell.Header>
                <ViewShell.Content>
                  <Suspense fallback={<EmailListFallback />}>
                    <EmailList ref={setListElement} />
                  </Suspense>
                </ViewShell.Content>
              </ViewShell.Main>
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/** Production Email view: sidebar tabs + inbox selector over an email-only list. */
export function EmailView(props: EmailViewProps) {
  return (
    <EmailViewProvider initialState={props.initialState}>
      <EmailViewRoot />
    </EmailViewProvider>
  );
}
