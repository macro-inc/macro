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

export interface PptxHeaderProps {
  documentId: string;
  name: () => string;
  openShare: () => void;
  download: () => Promise<void>;
}

/** The slides block's title menu operations and named header actions. */
export function pptxHeaderTools(props: PptxHeaderProps) {
  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      get label() {
        return t('entityActions.download');
      },
      icon: DownloadSimple,
      action: () => fireAndForget(props.download(), 'pptx-download'),
    },
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: () => t('entityActions.askMacro'),
    icon: ChatWithAgentIcon,
    action: () => openChatWithAgent(chatEntity(props)),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: () => t('entityActions.share'),
    icon: IconShared,
    action: props.openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, actions: { askMacro, share } };
}

/** The slides file as the entity Ask Macro starts a chat about. */
export function chatEntity(props: PptxHeaderProps) {
  return {
    type: 'document' as const,
    id: props.documentId,
    name: props.name(),
    fileType: 'pptx',
  };
}
