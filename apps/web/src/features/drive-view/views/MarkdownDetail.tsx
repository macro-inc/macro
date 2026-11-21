import { markdownEntityFromMetadata } from '@app/features/entity-appearance/queries/document-appearance';
import { FindAndReplace } from '@block-md/component/FindAndReplace';
import type { NativeBodyPopupComposition } from '@block-md/component/format-host/native-body-popup';
import { HostedMarkdownHeader } from '@block-md/component/HostedMarkdownHeader';
import {
  MarkdownDocument,
  MarkdownDocumentContent,
} from '@block-md/component/MarkdownDocument';
import { ModalsProvider } from '@block-md/component/ModalsProvider';
import { MarkdownSidePanelSections } from '@block-md/component/sidepanel/MarkdownSidePanelSections';
import { createMarkdownDocumentState } from '@block-md/context/markdown-document-state';
import { createMarkdownRouteNavigation } from '@block-md/primitives/create-markdown-route-navigation';
import {
  loadMarkdownDocument,
  type MarkdownDocumentData,
} from '@block-md/queries/markdown-document';
import { loadMarkdownCachedSnapshot } from '@block-md/queries/markdown-document-operations';
import type { MarkdownDocumentKind } from '@block-md/types';
import { desktopBodyFormatPopup } from '@block-md/views/body-format-popup';
import { MarkdownHeaderActions } from '@block-md/views/markdown-header-parts';
import { mobileBodyFormatPopup } from '@block-md/views/mobile/body-format-popup';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { useSplitHeaderScope } from '@components/app/SplitHeaderScope';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import type { DocumentEntity } from '@entity';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Telemetry } from '@macro-inc/observability';
import { DocumentNotificationReadMarker } from '@notifications';
import { useItemRawName } from '@queries/preview';
import { invalidateDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { Button } from '@ui';
import {
  createComputed,
  ErrorBoundary,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { FileDetailLoadGate } from '../components/FileDetail';
import type { FileDetailContext } from '../util/file-detail-context';

export type MarkdownDetailContext = FileDetailContext<MarkdownDocumentData>;

export type MarkdownDetailProps = {
  documentId: string;
  kind?: MarkdownDocumentKind;
  fallbackName?: string;
  /** The title menu's Duplicate and Delete in a hosted header. */
  onDuplicate?: (id: string, name: string) => void;
  onDelete?: () => void;
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
            aria-hidden={false}
            aria-label={`Loading ${entityLabel()}`}
            class="size-5 animate-spin"
          />
        }
      >
        <Match when={props.error !== undefined}>
          <div class="flex max-w-xl flex-col items-center gap-3 px-6 text-center">
            <span>This {entityLabel()} couldn’t be displayed.</span>
            <Button variant="secondary" size="sm" onClick={props.onAction}>
              {props.actionLabel ?? 'Reset'}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

/**
 * Shows a detail that threw while rendering as a plain message with Try
 * again, and records the error on telemetry rather than on screen.
 */
export function DetailErrorBoundary(
  props: ParentProps<{ entityType: string; entityId: string }>
) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        Telemetry.error(error, {
          surface: 'drive-detail',
          'entity.type': props.entityType,
          'entity.id': props.entityId,
        });
        return (
          <MarkdownDetailBodyState
            error={error}
            actionLabel="Try again"
            onAction={reset}
          />
        );
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}

function MarkdownDetailContent(props: {
  documentId: string;
  kind: MarkdownDocumentKind;
  fallbackName: string;
  data: MarkdownDocumentData;
  bodyFormatPopup: NativeBodyPopupComposition;
  onDuplicate?: (id: string, name: string) => void;
  onDelete?: () => void;
  children?: (context: MarkdownDetailContext) => JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  // A host that shows hosted headers gets the document's own, with its Info.
  const hostedHeader = useSplitHeaderScope();
  const notificationSource = useGlobalNotificationSource();
  const orchestrator = useGlobalBlockOrchestrator();
  const state = createMarkdownDocumentState();
  createMarkdownRouteNavigation(() => props.documentId, state.params.navigate);

  // Subscribe to live name updates so the title updates when another person renames it.
  const liveName = useItemRawName(() => ({
    id: props.documentId,
    type: 'document',
  }));
  const persistedName = () =>
    liveName() ?? props.data.metadata.documentName ?? '';

  // Mention chips and notifications aim an open document at a comment or node
  // through its block handle; without one the click only activates the view.
  createComputed(() => {
    const handle = orchestrator.registerBlockHandle('md', props.documentId);
    createMethodRegistration(() => handle, {
      goToLocationFromParams: state.params.navigate,
    });
  });

  const documentEntity = (): DocumentEntity | undefined => {
    const metadata = props.data.metadata;
    if (
      (props.kind !== 'document' && props.kind !== 'snippet') ||
      metadata.documentId !== props.documentId
    )
      return;
    return markdownEntityFromMetadata(metadata, persistedName());
  };
  return (
    <MarkdownDocument
      documentId={props.documentId}
      kind={props.kind}
      entity={documentEntity()}
      state={state}
      documentSource={props.data.connection}
      permissions={props.data.permissions}
      persistedName={persistedName()}
      fallbackName={props.fallbackName}
      bodyFormatPopup={props.bodyFormatPopup}
    >
      <ModalsProvider>
        {props.children?.({
          data: props.data,
          documentMetadata: props.data.metadata,
          userAccessLevel: props.data.userAccessLevel,
        })}
        <HostedMarkdownHeader
          collaborationStatus={() => {
            const connection = props.data.connection;
            return connection.type === 'session'
              ? state.session.status()
              : connection.source.status();
          }}
          onDuplicate={props.onDuplicate}
          onDelete={props.onDelete}
        />
        <SidePanel.Layout headerToggle={false} floating>
          <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
            <MarkdownSidePanelSections />
            {/* A hosted header lists its own actions. */}
            <Show when={!hostedHeader}>
              <MarkdownHeaderActions />
            </Show>
          </Show>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div class="absolute top-1.5 right-4 z-action-menu flex justify-end">
              <FindAndReplace hotkeyScope={panel.splitHotkeyScope} />
            </div>
            <DocumentNotificationReadMarker
              notificationSource={notificationSource}
              documentId={props.documentId}
            />
            <MarkdownDocumentContent
              hotkeyScope={panel.splitHotkeyScope}
              doInitialSync={
                props.data.connection.type === 'sync'
                  ? props.data.connection.doInitialSync
                  : undefined
              }
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
  return (
    <FileDetailLoadGate
      recover={invalidateDocumentLoadBundle}
      documentId={props.documentId}
      entityType="md"
      label={props.kind === 'task' ? 'task' : 'document'}
      load={loadMarkdownDocument}
      dispose={(data) => {
        if (data.connection.type === 'sync') data.connection.source.cleanup();
      }}
    >
      {(data) => (
        <MarkdownDetailContent
          documentId={props.documentId}
          kind={props.kind ?? 'document'}
          fallbackName={
            props.fallbackName ||
            blockNameToDefaultFile(
              props.kind && props.kind !== 'document' ? props.kind : 'md'
            )
          }
          data={data}
          bodyFormatPopup={
            isTouchDevice() ? mobileBodyFormatPopup : desktopBodyFormatPopup
          }
          onDuplicate={props.onDuplicate}
          onDelete={props.onDelete}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
