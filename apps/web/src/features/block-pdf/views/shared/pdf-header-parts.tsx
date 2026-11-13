import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useHasModificationData } from '@block-pdf/signal/save';
import { useHasComments } from '@block-pdf/store/comments/commentStore';
import {
  downloadDocxDocument,
  downloadPdfDocument,
  printPdfDocument,
} from '@block-pdf/util/pdf-file-actions';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId, useBlockName } from '@core/block';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useCopyLink } from '@core/util/useCopyLink';
import IconShared from '@icon/share.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import Printer from '@icon/system/regular/printer.svg';
import { blockNameToItemType } from '@service-storage/itemType';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfDocument } from '../../context/pdf-document-context';
import { LocationType, useCreateShareUrl } from '../../signal/location';

/**
 * The PDF block's title menu operations and named header actions.
 * `itemType` is undefined for a block name storage doesn't know, and then the
 * block shows no header.
 */
export function usePdfHeaderTools() {
  const pdf = usePdfDocument();
  const documentProxy = pdf.documentProxy;
  const isAuth = useIsAuthenticated();
  const documentId = useBlockId();
  const blockName = useBlockName();
  const hasModificationData = useHasModificationData();
  const hasComments = useHasComments();
  const fileName = useBlockDocumentName('Unknown Filename');

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'pdf',
    itemType: 'document',
    name: fileName() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const createShareUrl = useCreateShareUrl();
  const copyEntityLink = useCopyLink();

  const itemType = blockNameToItemType(blockName);
  const fileType = blockMetadataSignal()?.fileType;

  const copyLink = () => copyEntityLink(createShareUrl(LocationType.General));

  const fileActionAuth = () => ({
    isAuthenticated: !!isAuth(),
    openLogin: openLoginModal,
  });

  const printFile = createCallback(() =>
    printPdfDocument({
      ...fileActionAuth(),
      documentProxy: documentProxy(),
    })
  );

  const download = createCallback(() =>
    downloadPdfDocument({
      ...fileActionAuth(),
      documentProxy: documentProxy(),
      hasModifications: hasModificationData(),
      hasComments: hasComments(),
      documentId,
      fileName: fileName(),
    })
  );

  const downloadDocx = createCallback(() =>
    downloadDocxDocument({
      ...fileActionAuth(),
      documentId,
      fileName: fileName(),
    })
  );

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Print',
      icon: Printer,
      action: () => printFile(),
    },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadIcon,
      action: download,
    },
    ...(fileType === 'docx'
      ? [
          {
            group: 'file',
            label: 'Download DOCX',
            icon: DownloadIcon,
            action: downloadDocx,
          } as const,
        ]
      : []),
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () =>
      openChatWithAgent({
        type: 'document',
        id: documentId,
        name: fileName(),
        fileType,
      }),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { itemType, ops, openShare, copyLink, actions: { askMacro, share } };
}
