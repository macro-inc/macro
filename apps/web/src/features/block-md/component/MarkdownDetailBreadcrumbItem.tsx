import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { Permissions } from '@core/component/SharePermissions';
import { buildEntityData } from '@entity';
import { useMarkdownDocument } from '../context/markdown-document-context';
import type { MarkdownDocumentKind } from '../types';
import { useMarkdownName } from './MarkdownNameProvider';
import { useMarkdownDocumentTools } from './useMarkdownDocumentTools';

export function markdownDocumentBlockName(
  kind: MarkdownDocumentKind
): BlockName | BlockAlias {
  return kind === 'document' ? 'md' : kind;
}

export function MarkdownDetailBreadcrumbItem(props: {
  value: string;
  metadata: unknown;
  order: number;
  documentId: string;
  kind: MarkdownDocumentKind;
  fallbackName?: string;
  ownerId: string;
  projectId?: string;
  onClose: () => void;
  onDuplicate: (id: string, name: string) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const { displayName } = useMarkdownName();
  const { permissions, state } = useMarkdownDocument();
  const { fileOperations, menuTools } = useMarkdownDocumentTools();
  const blockName = () => markdownDocumentBlockName(props.kind);
  const documentName = () =>
    displayName() ??
    props.fallbackName ??
    (props.kind === 'task' ? 'New Task' : 'Untitled');
  const focusDocument = () => state.editor.md.editor?.focus();

  const menuPermissions = () => {
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  useBlockEntityCommands({
    id: props.documentId,
    scopeId: panel.splitHotkeyScope,
    onDeleted: props.onClose,
    resolveEntity: () =>
      buildEntityData({
        id: props.documentId,
        name: documentName(),
        blockName: blockName(),
        ownerId: props.ownerId,
        projectId: props.projectId,
      }),
  });

  return (
    <ViewBreadcrumbs.Item
      value={props.value}
      metadata={props.metadata}
      order={props.order}
    >
      {(item) => (
        <div class="flex min-w-0 items-center motion-safe:animate-[dialog-overlay-open_150ms_ease-out]">
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={() => {
              item.onSelect();
              focusDocument();
            }}
            tooltip={documentName()}
          >
            <EntityIcon targetType={blockName()} size="xs" class="shrink-0" />
            <span class="truncate">{documentName()}</span>
          </ViewBreadcrumbs.Button>
          <div class="shrink-0">
            <SplitFileMenu
              id={props.documentId}
              itemType="document"
              name={documentName()}
              ops={fileOperations}
              tools={menuTools}
              entityKind={blockName()}
              permissions={menuPermissions()}
              onDuplicate={(id) => props.onDuplicate(id, documentName())}
              onDelete={props.onClose}
            />
          </div>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}
