import { FindAndReplace } from '@block-md/component/FindAndReplace';
import {
  MarkdownDocument,
  MarkdownDocumentContent,
} from '@block-md/component/MarkdownDocument';
import { ModalsProvider } from '@block-md/component/ModalsProvider';
import { MarkdownSidePanelSections } from '@block-md/component/sidepanel/MarkdownSidePanelSections';
import { createMarkdownDocumentState } from '@block-md/context/markdown-document-state';
import { OldOverlay } from '@block-md/history/OldOverlay';
import {
  loadMarkdownDocument,
  type MarkdownDocumentData,
} from '@block-md/queries/markdown-document';
import { loadMarkdownCachedSnapshot } from '@block-md/queries/markdown-document-operations';
import type { MarkdownDocumentKind } from '@block-md/types';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { createMethodRegistration } from '@core/orchestrator';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import {
  createComputed,
  createResource,
  ErrorBoundary,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import type { FileDetailContext } from '../util/file-detail-context';

export type MarkdownDetailContext = FileDetailContext<MarkdownDocumentData>;

export type MarkdownDetailProps = {
  documentId: string;
  kind?: MarkdownDocumentKind;
  fallbackName?: string;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
  children?: (context: MarkdownDetailContext) => JSX.Element;
};

export function MarkdownDetailBodyState(props: {
  entityLabel?: string;
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const entityLabel = () => props.entityLabel ?? 'document';

  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <Switch
        fallback={
          <SpinnerIcon
            aria-label={`Loading ${entityLabel()}`}
            class="size-5 animate-spin"
          />
        }
      >
        <Match when={props.error !== undefined}>
          <div class="flex max-w-xl flex-col items-center gap-3 px-6 text-center">
            <span>This {entityLabel()} couldn’t be displayed.</span>
            <pre class="max-h-48 max-w-full overflow-auto whitespace-pre-wrap text-left text-failure text-xs">
              {String(props.error)}
            </pre>
            <Button variant="outline" size="sm" onClick={props.onAction}>
              {props.actionLabel ?? 'Reset'}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function MarkdownDetailContent(props: {
  documentId: string;
  kind: MarkdownDocumentKind;
  fallbackName: string;
  data: MarkdownDocumentData;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
  children?: (context: MarkdownDetailContext) => JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const orchestrator = useGlobalBlockOrchestrator();
  const state = createMarkdownDocumentState();

  // Mention chips and notifications aim an open document at a comment or node
  // through its block handle; without one the click only activates the view.
  createComputed(() => {
    const handle = orchestrator.registerBlockHandle('md', props.documentId);
    createMethodRegistration(() => handle, {
      goToLocationFromParams: state.params.navigate,
    });
  });

  return (
    <MarkdownDocument
      documentId={props.documentId}
      kind={props.kind}
      state={state}
      documentSource={{ type: 'sync', source: props.data.source }}
      permissions={props.data.permissions}
      persistedName={props.data.metadata.documentName}
      fallbackName={props.fallbackName}
    >
      <ModalsProvider
        shareOpen={props.shareOpen}
        onShareOpenChange={props.onShareOpenChange}
      >
        <OldOverlay />
        {props.children?.({
          data: props.data,
          documentMetadata: props.data.metadata,
          userAccessLevel: props.data.userAccessLevel,
        })}
        <SidePanel.Layout headerToggle={false}>
          <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
            <MarkdownSidePanelSections />
          </Show>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div class="absolute top-1.5 right-4 z-action-menu flex justify-end">
              <FindAndReplace hotkeyScope={panel.splitHotkeyScope} />
            </div>
            <DocumentDebouncedNotificationReadMarker
              notificationSource={notificationSource}
              documentId={props.documentId}
            />
            <MarkdownDocumentContent
              hotkeyScope={panel.splitHotkeyScope}
              doInitialSync={props.data.doInitialSync}
              loadCachedSnapshot={() =>
                loadMarkdownCachedSnapshot(props.documentId)
              }
            />
          </div>
        </SidePanel.Layout>
      </ModalsProvider>
    </MarkdownDocument>
  );
}

/** Renders a markdown document without a block container or split header. */
export function MarkdownDetail(props: MarkdownDetailProps) {
  const [document, { refetch }] = createResource(
    () => props.documentId,
    loadMarkdownDocument
  );
  const entityLabel = () => (props.kind === 'task' ? 'task' : 'document');

  return (
    <Suspense
      fallback={<MarkdownDetailBodyState entityLabel={entityLabel()} />}
    >
      <Switch>
        <Match when={document.error}>
          {(error) => (
            <MarkdownDetailBodyState
              entityLabel={entityLabel()}
              error={error()}
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          )}
        </Match>
        <Match when={document()}>
          {(data) => (
            <ErrorBoundary
              fallback={(error, reset) => (
                <MarkdownDetailBodyState
                  entityLabel={entityLabel()}
                  error={error}
                  actionLabel="Reset"
                  onAction={reset}
                />
              )}
            >
              <MarkdownDetailContent
                documentId={props.documentId}
                kind={props.kind ?? 'document'}
                fallbackName={props.fallbackName ?? 'Untitled'}
                data={data()}
                shareOpen={props.shareOpen}
                onShareOpenChange={props.onShareOpenChange}
                children={props.children}
              />
            </ErrorBoundary>
          )}
        </Match>
      </Switch>
    </Suspense>
  );
}
