import {
  EntityDetail,
  entityDetailBlockType,
  entityDetailHostsSplitHeader,
} from '@app/components/entity-detail/EntityDetail';
import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import { EntityDetailFrame } from '@app/components/entity-detail/EntityDetailFrame';
import type { EntityDetailTarget } from '@app/components/entity-detail/entity-detail-target';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { MarkdownDetail } from '@app/features/drive-view/views/MarkdownDetail';
import { FileDetailBreadcrumbItem } from '@app/features/drive-view/views/FileDetailBreadcrumbItem';
import { MarkdownDetailBreadcrumbItem } from '@block-md/component/MarkdownDetailBreadcrumbItem';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useDocumentShareModal } from '@core/component/TopBar/shareModal';
import { For, type JSX, onCleanup, Show } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import { useCrmWorkspace } from '../context/workspace-context';
import { createRecordName } from './record-detail';

type DocumentTarget = Extract<EntityDetailTarget, { type: 'document' }>;

/**
 * A linked item retains the Customers shell and its route-owned source trail.
 * Its headers are top bars, which carry the shell's navigation controls.
 */
export function CrmItemDetail(props: { sourceName: string }) {
  const crm = useCrmContext();
  const route = useCrmWorkspace().host.record;
  const panel = useSplitPanelOrThrow();
  const item = () => route.item()!;
  const records = () => (crm.canAccess() ? route.records() : []);
  const value = () => `item:${item().itemType}:${item().itemId}`;
  const target = (): EntityDetailTarget => {
    const current = item();
    if (current.itemType === 'document') {
      return {
        type: 'document',
        id: current.itemId,
        fileType: current.itemFileType ?? 'md',
        ...(current.itemSubType
          ? { subType: { type: current.itemSubType } }
          : {}),
        fallbackName: current.name,
      };
    }
    return {
      type: current.itemType,
      id: current.itemId,
      fallbackName: current.name,
    };
  };
  const document = () => {
    const current = target();
    return current.type === 'document' ? current : undefined;
  };
  const nativeDocument = () => {
    const current = document();
    const blockType = current && entityDetailBlockType(current);
    return current && blockType && blockType !== 'spreadsheet'
      ? { target: current, blockType }
      : undefined;
  };
  const openShare = useDocumentShareModal(() => {
    const current = nativeDocument();
    if (!current) return;
    return { documentId: current.target.id, blockAlias: current.blockType };
  });
  onCleanup(crm.registerTaskComposerRecord(() => records().at(-1)));

  return (
    <ViewBreadcrumbs.Root
      value={value()}
      onChange={(next) => {
        if (next === 'crm-view')
          return records().length ? route.close() : route.closeItem();
        const index = records().findIndex(
          (record) => `${record.type}:${record.id}` === next
        );
        if (index === -1) return;
        if (index === records().length - 1) return route.closeItem();
        route.open(records().slice(0, index + 1));
      }}
    >
      <ViewBreadcrumbs.Item
        value="crm-view"
        metadata={{ type: 'companies' }}
        order={0}
      >
        {(crumb) => (
          <ViewBreadcrumbs.ReturnButton onClick={crumb.onSelect}>
            {props.sourceName}
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <For each={records()}>
        {(record, index) => {
          const name = createRecordName(record);
          return (
            <ViewBreadcrumbs.Item
              value={`${record.type}:${record.id}`}
              metadata={{ type: record.type, id: record.id }}
              order={index() + 1}
            >
              {(crumb) => (
                <ViewBreadcrumbs.Button
                  class="gap-1.5"
                  isActive={crumb.isActive()}
                  onClick={crumb.onSelect}
                  tooltip={name()}
                >
                  <EntityIcon
                    targetType={
                      record.type === 'company' ? 'crm_company' : 'contact'
                    }
                    size="xs"
                    class="shrink-0"
                  />
                  <span class="truncate">{name()}</span>
                </ViewBreadcrumbs.Button>
              )}
            </ViewBreadcrumbs.Item>
          );
        }}
      </For>
      <SidePanel.Root floating>
        <EntityDetailFrame
          target={document()}
          topBar={
            <Show when={nativeDocument()}>
              {(current) => (
                <ViewShell.TopBar class="touch:flex">
                  <ViewShell.TopBarTitle>
                    <ViewBreadcrumbs.Outlet
                      aria-label="CRM item location"
                      fallback={<EntityDetailBreadcrumbSkeleton />}
                    />
                  </ViewShell.TopBarTitle>
                  <ViewShell.TopBarActions>
                    <SidePanel.HeaderActionsOutlet />
                    <ShareTrigger
                      onClick={openShare}
                      id={current().target.id}
                      blockType={current().blockType}
                      hotkeyScope={panel.splitHotkeyScope}
                    />
                    <SidePanel.Toggle />
                  </ViewShell.TopBarActions>
                </ViewShell.TopBar>
              )}
            </Show>
          }
        >
          {/* Preview headers own the live item title and menu after this source prefix. */}
          <Show
            when={document()}
            fallback={
              <EntityDetail
                target={target()}
                previewHeaderLeading={
                  <ViewBreadcrumbs.Outlet
                    aria-label="CRM item location"
                    class="max-w-[min(40vw,24rem)] overflow-hidden"
                  />
                }
              />
            }
          >
            {(current) => (
              <CrmDocumentDetail
                target={current()}
                value={value()}
                order={records().length + 1}
                headerLeading={
                  <ViewBreadcrumbs.Outlet aria-label="CRM item location" />
                }
              />
            )}
          </Show>
        </EntityDetailFrame>
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

function CrmDocumentDetail(props: {
  target: DocumentTarget;
  value: string;
  order: number;
  headerLeading: JSX.Element;
}) {
  const route = useCrmWorkspace().host.record;
  const markdown = () =>
    entityDetailHostsSplitHeader(props.target) ? props.target : undefined;
  const duplicate = (id: string, name: string) =>
    route.openItem({ ...props.target, name, id });
  return (
    <Show
      when={markdown()}
      fallback={
        <EntityDetail
          target={props.target}
          previewHeaderLeading={props.headerLeading}
          onClose={route.closeItem}
          onDuplicate={duplicate}
        >
          {(context) => {
            if (context.type !== 'document') return null;
            return (
              <FileDetailBreadcrumbItem
                value={props.value}
                metadata={props.target}
                order={props.order}
                documentMetadata={context.documentMetadata}
                userAccessLevel={context.userAccessLevel}
                blockType={entityDetailBlockType(props.target)!}
                download={context.download}
                operations={context.operations}
                fallbackName={props.target.fallbackName}
                onClose={route.closeItem}
                onDuplicate={duplicate}
              />
            );
          }}
        </EntityDetail>
      }
    >
      {(current) => (
        <MarkdownDetail
          documentId={current().id}
          kind={current().subType?.type ?? 'document'}
          fallbackName={current().fallbackName}
          onDuplicate={duplicate}
          onDelete={route.closeItem}
        >
          {(context) => (
            <MarkdownDetailBreadcrumbItem
              value={props.value}
              metadata={props.target}
              order={props.order}
              documentId={current().id}
              kind={current().subType?.type ?? 'document'}
              fallbackName={current().fallbackName}
              ownerId={context.documentMetadata.owner}
              projectId={context.documentMetadata.projectId ?? undefined}
              onClose={route.closeItem}
              onDuplicate={duplicate}
            />
          )}
        </MarkdownDetail>
      )}
    </Show>
  );
}
