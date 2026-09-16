import {
  EntityDetail,
  entityDetailBlockType,
} from '@app/components/entity-detail/EntityDetail';
import { EntityDetailBreadcrumbItem } from '@app/components/entity-detail/EntityDetailBreadcrumbItem';
import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import {
  EntityDetailNavigationStack,
  type EntityDetailNavigationStackEntry,
  type EntityDetailTarget,
  entityDetailTarget,
  useEntityDetailNavigationStack,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  MarkdownDetail,
  MarkdownDetailBodyState,
} from '@block-md/component/MarkdownDetail';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import type { MarkdownDocumentKind } from '@block-md/types';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ShareDialogContext,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import {
  createSignal,
  ErrorBoundary,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { FileDetailBreadcrumbItem } from './FileDetailBreadcrumbItem';

const DRIVE_VIEW_BREADCRUMB = 'drive-view';

function DriveViewBreadcrumbItem(props: { name: string }) {
  return (
    <ViewBreadcrumbs.Item
      value={DRIVE_VIEW_BREADCRUMB}
      metadata={{ type: 'drive' }}
      order={0}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          isActive={item.isActive()}
          onClick={item.onSelect}
        >
          <span class="truncate">{props.name}</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function DriveDetailAncestorBreadcrumbs() {
  const navigationStack = useEntityDetailNavigationStack();
  const ancestors = () => navigationStack.entries.slice(0, -1);

  return (
    <For each={ancestors()}>
      {(entry, index) => (
        <EntityDetailBreadcrumbItem entry={entry} order={index() + 1} />
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

function DriveDetailTopBar() {
  const navigationStack = useEntityDetailNavigationStack();
  const panel = useSplitPanelOrThrow();
  const activeDetail = () => {
    const target = navigationStack.active()?.data;
    const blockType = target ? entityDetailBlockType(target) : undefined;
    return target?.type === 'document' && blockType
      ? { target, blockType }
      : undefined;
  };

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 border-edge border-b px-3">
      <ViewBreadcrumbs.Outlet
        aria-label="File location"
        fallback={<EntityDetailBreadcrumbSkeleton />}
      />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <Show when={activeDetail()}>
          {(detail) => (
            <ShareTrigger
              id={detail().target.id}
              blockType={detail().blockType}
              hotkeyScope={panel.splitHotkeyScope}
            />
          )}
        </Show>
        <SidePanel.Toggle />
      </div>
    </div>
  );
}

function StackEntityDetail(props: {
  entry: EntityDetailNavigationStackEntry;
  order: number;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
}) {
  const navigationStack = useEntityDetailNavigationStack();
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
              shareOpen={props.shareOpen}
              onShareOpenChange={props.onShareOpenChange}
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
                  onDuplicate={(id, name) =>
                    navigationStack.navigate(
                      entityDetailTarget.document({
                        id,
                        fileType: 'md',
                        subType: target().subType,
                        fallbackName: name,
                      })
                    )
                  }
                />
              )}
            </MarkdownDetail>
          );
        }}
      </Match>
      <Match when={true}>
        <Show when={props.entry.data.type !== 'document'}>
          <EntityDetailBreadcrumbItem entry={props.entry} order={props.order} />
        </Show>
        <EntityDetail
          target={props.entry.data}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => (
            <FileDetailBreadcrumbItem
              value={props.entry.value}
              metadata={props.entry.data}
              order={props.order}
              documentMetadata={context.documentMetadata}
              userAccessLevel={context.userAccessLevel}
              blockType={context.blockType}
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
          )}
        </EntityDetail>
      </Match>
    </Switch>
  );
}

export function DriveDetailView(props: { rootName: string }) {
  const navigationStack = useEntityDetailNavigationStack();
  const [shareOpen, setShareOpen] = createSignal(false);

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <ViewBreadcrumbs.Root
        value={navigationStack.active()?.value ?? DRIVE_VIEW_BREADCRUMB}
        onChange={(value) => {
          if (value === DRIVE_VIEW_BREADCRUMB) {
            navigationStack.clear();
            return;
          }
          navigationStack.popTo(value);
        }}
      >
        <DriveViewBreadcrumbItem name={props.rootName} />
        <DriveDetailAncestorBreadcrumbs />
        <SidePanel.Root>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <DriveDetailTopBar />
            <div class="relative min-h-0 min-w-0 flex-1">
              <EntityDetailNavigationStack.Outlet>
                {(entry, state) => (
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
                      entry={entry}
                      order={state.entries.length}
                      shareOpen={shareOpen()}
                      onShareOpenChange={setShareOpen}
                    />
                  </ErrorBoundary>
                )}
              </EntityDetailNavigationStack.Outlet>
            </div>
          </div>
        </SidePanel.Root>
      </ViewBreadcrumbs.Root>
    </ShareDialogContext.Provider>
  );
}
