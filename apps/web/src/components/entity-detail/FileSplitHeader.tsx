import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/block-tool';
import { FileDownloadHeader } from '@components/app/FileDownloadHeader';
import { SidePanel } from '@components/app/side-panel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  type FileOperation,
  SplitFileMenu,
} from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  AccessBadge,
  EntitySplitLabel,
  SplitTitleFileMenu,
} from '@components/app/split-layout/components/SplitLabel';
import type { BlockAlias, BlockName } from '@core/block';
import { FileTypeLabel } from '@core/component/FileTypeChip';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import type { FileDownloadController } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import IconShared from '@icon/share.svg';
import Download from '@icon/system/regular/download.svg';
import { useItemRawName } from '@queries/preview';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { Show } from 'solid-js';

/** Kinds whose standalone title shows the file's type beside its name. */
const KINDS_WITH_TYPE_LABEL: readonly (BlockName | BlockAlias)[] = [
  'image',
  'code',
  'csv',
  'unknown',
];

/**
 * A file's header where a touch view shows the file beside its list: the
 * title island with its menu, the type label, the viewer's access, and the
 * file's own header actions, as the file's block shows them on touch.
 * `EntityDetail` renders it inside a `SplitHeaderScope`, so a file looks the
 * same in a split of its own and beside a list.
 *
 * The file blocks still build one header for desktop and touch
 * (`ResponsiveBlockToolbar`). This is that header's touch arrangement without
 * a legacy Block; it goes when those blocks get a mobile view to host instead.
 */
export function FileSplitHeader(props: {
  blockType: BlockName | BlockAlias;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  fallbackName?: string;
  operations?: FileOperation[];
  download?: FileDownloadController;
  onClose?: () => void;
  onDuplicate?: (id: string, name: string) => void;
}) {
  const documentId = () => props.documentMetadata.documentId;
  const liveName = useItemRawName(() => ({
    id: documentId(),
    type: 'document',
  }));
  const name = () =>
    liveName() ??
    props.documentMetadata.documentName ??
    props.fallbackName ??
    'Untitled';
  const permissions = () => getPermissions(props.userAccessLevel);
  const canEdit = () => hasPermissions(permissions(), Permissions.CAN_EDIT);
  const targetType = () =>
    props.blockType === 'unknown'
      ? (props.documentMetadata.fileType ?? props.blockType)
      : props.blockType;
  // Videos keep download beside their actions; other files in their menu.
  const downloadInHeader = () => props.blockType === 'video';

  const openShare = useShareModal(() => ({
    id: documentId(),
    blockAlias: props.blockType,
    itemType: 'document',
    name: name(),
    userPermissions: permissions(),
    owner: props.documentMetadata.owner,
  }));

  const chatEntity = () => ({
    type: 'document' as const,
    id: documentId(),
    name: name(),
    fileType: props.documentMetadata.fileType ?? props.blockType,
  });

  const tools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () => fireAndForget(openChatWithAgent(chatEntity()), 'file'),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  const ops = (): FileOperation[] => {
    const download = props.download;
    return [
      { op: 'rename' },
      { op: 'copy' },
      { op: 'moveToProject' },
      ...(props.operations ?? []),
      ...(download && !downloadInHeader()
        ? [
            {
              group: 'file' as const,
              label: 'Download',
              icon: Download,
              action: () => fireAndForget(download.start(), 'file-download'),
            },
          ]
        : []),
      { op: 'delete' },
    ];
  };

  return (
    <>
      <Show when={downloadInHeader() && props.download}>
        {(download) => <FileDownloadHeader download={download()} />}
      </Show>
      <SplitHeaderLeft>
        <EntitySplitLabel
          targetType={targetType()}
          name={name()}
          document={{
            documentId: documentId(),
            ownerId: props.documentMetadata.owner,
            createdAt: props.documentMetadata.createdAt,
            updatedAt: props.documentMetadata.updatedAt,
          }}
          lockRename={permissions() !== Permissions.OWNER}
          badges={
            <Show when={KINDS_WITH_TYPE_LABEL.includes(props.blockType)}>
              <FileTypeLabel
                fileType={props.documentMetadata.fileType}
                entityKind={props.blockType}
              />
            </Show>
          }
        />
        <Show when={!canEdit()}>
          <HeaderIsland>
            <AccessBadge
              canEdit={canEdit()}
              canComment={hasPermissions(
                permissions(),
                Permissions.CAN_COMMENT
              )}
              canView={hasPermissions(permissions(), Permissions.CAN_VIEW)}
            />
          </HeaderIsland>
        </Show>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <HeaderIsland class="has-[[data-side-panel-header-actions]:empty]:hidden">
          <SidePanel.HeaderActionsOutlet />
        </HeaderIsland>
      </SplitHeaderRight>
      <SplitTitleFileMenu>
        <SplitFileMenu
          id={documentId()}
          itemType="document"
          name={name()}
          ops={ops()}
          tools={tools}
          entityKind={props.blockType}
          permissions={permissions()}
          onDuplicate={
            props.onDuplicate
              ? (id) => props.onDuplicate?.(id, name())
              : undefined
          }
          onDelete={props.onClose}
          buttonClass="order-last"
        />
      </SplitTitleFileMenu>
    </>
  );
}
