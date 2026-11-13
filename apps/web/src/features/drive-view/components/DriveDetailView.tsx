import {
  EntityDetail,
  entityDetailBlockType,
  entityDetailHostsSplitHeader,
} from '@app/components/entity-detail/EntityDetail';
import { EntityDetailBreadcrumbItem } from '@app/components/entity-detail/EntityDetailBreadcrumbItem';
import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import {
  type EntityDetailNavigationEntry,
  type EntityDetailTarget,
  entityDetailTarget,
} from '@app/components/entity-detail/entity-detail-target';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import type { MarkdownDocumentKind } from '@block-md/types';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useDocumentShareModal } from '@core/component/TopBar/shareModal';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ErrorBoundary, For, Match, Show, Switch } from 'solid-js';
import { useOptionalDriveView } from '../context/drive-context';
import { driveLocationBreadcrumbs } from '../core/breadcrumbs';
import { useDriveDetailNavigation } from '../drive-detail-navigation';
import { FileDetailBreadcrumbItem } from '../views/FileDetailBreadcrumbItem';
import {
  MarkdownDetail,
  MarkdownDetailBodyState,
} from '../views/MarkdownDetail';
import { DriveBreadcrumbsOutlet } from './DriveBreadcrumbs';

function DriveDetailAncestorBreadcrumbs(props: { orderOffset: number }) {
  const navigationStack = useDriveDetailNavigation();
  const ancestors = () => navigationStack.entries().slice(0, -1);

  return (
    <For each={ancestors()}>
      {(entry, index) => (
        <EntityDetailBreadcrumbItem
          entry={entry}
          order={props.orderOffset + index()}
        />
      )}
    </For>
  );
}

type DocumentDetailTarget = Extract<EntityDetailTarget, { type: 'document' }>;

function markdownKind(target: DocumentDetailTarget): MarkdownDocumentKind {
  const kind = target.subType?.type;
  if (kind === 'task' || kind === 'snippet' || kind === 'skill') return kind;
  return 'document';
}

/**
 * Spreadsheets, databases and forms use their live block in PreviewPanel,
 * which supplies its own title, sharing controls and the enclosing ViewShell's
 * sidebar toggle.
 */
function hasBlockHeader(target: EntityDetailTarget) {
  return (
    target.type === 'database' ||
    target.type === 'form' ||
    entityDetailBlockType(target) === 'spreadsheet'
  );
}

function DriveDetailTopBar() {
  const navigationStack = useDriveDetailNavigation();
  const panel = useSplitPanelOrThrow();
  const activeDetail = () => {
    const target = navigationStack.active()?.data;
    const blockType = target ? entityDetailBlockType(target) : undefined;
    return target?.type === 'document' && blockType
      ? { target, blockType }
      : undefined;
  };
  const openShare = useDocumentShareModal(() => {
    const detail = activeDetail();
    if (!detail) return;
    return {
      documentId: detail.target.id,
      blockAlias: detail.blockType,
    };
  });

  return (
    <ViewShell.TopBar class="touch:flex">
      <ViewShell.TopBarTitle>
        <DriveBreadcrumbsOutlet
          aria-label="File location"
          fallback={<EntityDetailBreadcrumbSkeleton />}
        />
      </ViewShell.TopBarTitle>
      <ViewShell.TopBarActions>
        <SidePanel.HeaderActionsOutlet />
        <Show when={activeDetail()}>
          {(detail) => (
            <ShareTrigger
              onClick={openShare}
              id={detail().target.id}
              blockType={detail().blockType}
              hotkeyScope={panel.splitHotkeyScope}
            />
          )}
        </Show>
        <SidePanel.Toggle />
      </ViewShell.TopBarActions>
    </ViewShell.TopBar>
  );
}

function StackEntityDetail(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
}) {
  const navigationStack = useDriveDetailNavigation();
  const markdownTarget = () => {
    const target = props.entry.data;
    const blockType = entityDetailBlockType(target);
    return target.type === 'document' &&
      (blockType === 'md' ||
        blockType === 'task' ||
        blockType === 'snippet' ||
        blockType === 'skill')
      ? target
      : undefined;
  };

  const duplicate = (target: DocumentDetailTarget, id: string, name: string) =>
    navigationStack.navigate(
      entityDetailTarget.document({
        id,
        fileType: 'md',
        subType: target.subType,
        fallbackName: name,
      })
    );

  return (
    <Switch>
      <Match when={markdownTarget()}>
        {(target) => {
          const kind = () => markdownKind(target());
          return (
            <MarkdownDetail
              documentId={target().id}
              kind={kind()}
              fallbackName={target().fallbackName}
              onDuplicate={(id, name) => duplicate(target(), id, name)}
              onDelete={navigationStack.pop}
            >
              {(context) => (
                <MarkdownDetailBreadcrumbItem
                  value={props.entry.value}
                  metadata={props.entry.data}
                  order={props.order}
                  documentId={target().id}
                  kind={kind()}
                  fallbackName={target().fallbackName}
                  ownerId={context.data.metadata.owner}
                  projectId={context.data.metadata.projectId ?? undefined}
                  onClose={navigationStack.pop}
                  onDuplicate={(id, name) => duplicate(target(), id, name)}
                />
              )}
            </MarkdownDetail>
          );
        }}
      </Match>
      <Match when={true}>
        <EntityDetail
          target={props.entry.data}
          previewHeaderLeading={
            <Show when={hasBlockHeader(props.entry.data)}>
              <DriveBreadcrumbsOutlet
                aria-label="File location"
                class="max-w-[min(40vw,24rem)] overflow-hidden"
              >
                <ViewBreadcrumbs.Separator />
              </DriveBreadcrumbsOutlet>
            </Show>
          }
        >
          {(context) => {
            if (context.type !== 'document') return null;
            return (
              <FileDetailBreadcrumbItem
                download={context.download}
                value={props.entry.value}
                metadata={props.entry.data}
                order={props.order}
                documentMetadata={context.documentMetadata}
                userAccessLevel={context.userAccessLevel}
                blockType={entityDetailBlockType(props.entry.data)!}
                operations={context.operations}
                fallbackName={props.entry.data.fallbackName}
                onClose={navigationStack.pop}
                onDuplicate={(id, name) => {
                  const target = props.entry.data;
                  if (target.type !== 'document') return;
                  navigationStack.navigate(
                    entityDetailTarget.document({
                      id,
                      fileType: target.fileType,
                      subType: target.subType,
                      fallbackName: name,
                    })
                  );
                }}
              />
            );
          }}
        </EntityDetail>
      </Match>
    </Switch>
  );
}

export function DriveDetailView() {
  const drive = useOptionalDriveView();
  const breadcrumbOrderOffset = () =>
    drive
      ? driveLocationBreadcrumbs(
          drive.state.value().location,
          drive.sidebar.folders()
        ).length
      : 0;
  const navigationStack = useDriveDetailNavigation();
  const activeHasBlockHeader = () => {
    const target = navigationStack.active()?.data;
    return target !== undefined && hasBlockHeader(target);
  };
  // Touch shows a document's own split header, as its standalone view does.
  const hostsSplitHeader = () => {
    const target = navigationStack.active()?.data;
    return (
      isTouchDevice() &&
      target !== undefined &&
      entityDetailHostsSplitHeader(target)
    );
  };

  return (
    <>
      <DriveDetailAncestorBreadcrumbs orderOffset={breadcrumbOrderOffset()} />
      <SidePanel.Root floating>
        <SplitHeaderScope.Root when={hostsSplitHeader()}>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <Switch>
              <Match when={hostsSplitHeader()}>
                <SplitHeaderScope.TopBar />
              </Match>
              <Match when={!activeHasBlockHeader()}>
                <DriveDetailTopBar />
              </Match>
            </Switch>
            <div class="relative min-h-0 min-w-0 flex-1">
              <Show when={navigationStack.active()}>
                {(entry) => (
                  <ErrorBoundary
                    fallback={(error, reset) => (
                      <MarkdownDetailBodyState
                        error={error}
                        actionLabel="Reset"
                        onAction={reset}
                      />
                    )}
                  >
                    <StackEntityDetail
                      entry={entry()}
                      order={
                        breadcrumbOrderOffset() +
                        navigationStack.entries().length -
                        1
                      }
                    />
                  </ErrorBoundary>
                )}
              </Show>
            </div>
          </div>
        </SplitHeaderScope.Root>
      </SidePanel.Root>
    </>
  );
}
