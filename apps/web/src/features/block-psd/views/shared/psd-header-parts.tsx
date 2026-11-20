import { askMacroTool } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';

export interface PsdHeaderProps {
  openShare: () => void;
  download: () => Promise<void>;
}

/** The psd block's title menu operations and named header actions. */
export function psdHeaderTools(props: PsdHeaderProps) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Image');

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
      action: () => fireAndForget(props.download(), 'psd-editor'),
    },
    { op: 'delete' },
  ];

  const share: BlockTool = {
    group: 'sharing',
    label: () => t('entityActions.share'),
    icon: IconShared,
    action: props.openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  const askMacro = askMacroTool(() => ({
    type: 'document',
    id: documentId,
    name: name() ?? '',
    fileType: 'psd',
  }));

  return { ops, actions: { askMacro, share } };
}
