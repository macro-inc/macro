import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { getPermissions } from '@core/component/SharePermissions';
import { buildEntityData } from '@entity';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

const fileOperations: FileOperation[] = [
  { op: 'copy' },
  { op: 'rename' },
  { op: 'moveToProject' },
  { op: 'delete' },
];

export function FileDetailBreadcrumbItem(props: {
  value: string;
  metadata: unknown;
  order: number;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  blockType: BlockName | BlockAlias;
  fallbackName?: string;
  onClose: () => void;
  onDuplicate: (id: string, name: string) => void;
}) {
  const panel = useSplitPanelOrThrow();
  const documentId = () => props.documentMetadata.documentId;
  const documentName = () =>
    props.documentMetadata.documentName ?? props.fallbackName ?? 'Untitled';

  useBlockEntityCommands({
    id: documentId(),
    scopeId: panel.splitHotkeyScope,
    onDeleted: props.onClose,
    resolveEntity: () =>
      buildEntityData({
        id: documentId(),
        name: documentName(),
        blockName: props.blockType,
        ownerId: props.documentMetadata.owner,
        projectId: props.documentMetadata.projectId ?? undefined,
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
            onClick={item.onSelect}
            tooltip={documentName()}
          >
            <EntityIcon
              targetType={props.blockType}
              size="xs"
              class="shrink-0"
            />
            <span class="truncate">{documentName()}</span>
          </ViewBreadcrumbs.Button>
          <div class="shrink-0">
            <SplitFileMenu
              id={documentId()}
              itemType="document"
              name={documentName()}
              ops={fileOperations}
              entityKind={props.blockType}
              permissions={getPermissions(props.userAccessLevel)}
              onDuplicate={(id) => props.onDuplicate(id, documentName())}
              onDelete={props.onClose}
            />
          </div>
        </div>
      )}
    </ViewBreadcrumbs.Item>
  );
}
