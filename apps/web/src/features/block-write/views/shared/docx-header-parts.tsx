import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { fireAndForget } from '@core/util/fireAndForget';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import { Badge } from '@ui';

export interface DocxHeaderProps {
  documentId: string;
  name: () => string;
  openShare: () => void;
  download: () => Promise<void>;
}

/** The Word block's title menu operations and named header actions. */
export function docxHeaderTools(props: DocxHeaderProps) {
  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      get label() {
        return t('entityActions.downloadDocx');
      },
      icon: DownloadSimple,
      action: () => fireAndForget(props.download(), 'docx-download'),
    },
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () => openChatWithAgent(chatEntity(props)),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: props.openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, actions: { askMacro, share } };
}

/** The Word file as the entity Ask Macro starts a chat about. */
export function chatEntity(props: DocxHeaderProps) {
  return {
    type: 'document' as const,
    id: props.documentId,
    name: props.name(),
    fileType: 'docx',
  };
}

/** Marks the Word editor as a beta on both platforms. */
export function BetaBadge() {
  return (
    <Badge variant="outline" size="xs">
      Beta
    </Badge>
  );
}
