import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import FileCsv from '@icon/system/regular/file-csv.svg';
import FileXls from '@icon/system/regular/file-xls.svg';
import { Badge } from '@ui';

export interface SpreadsheetHeaderProps {
  documentId: string;
  name: () => string;
  openShare: () => void;
  download: (format: 'xlsx' | 'csv') => void;
  /**
   * The open sheet and selection, for Ask Macro; undefined until the workbook
   * has synced, so Ask Macro then asks about the whole spreadsheet.
   */
  chatContext: () => Record<string, string> | undefined;
}

/** The spreadsheet block's title menu operations and named header actions. */
export function spreadsheetHeaderTools(props: SpreadsheetHeaderProps) {
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
      children: [
        {
          get label() {
            return t('entityActions.downloadAsXlsx');
          },
          icon: FileXls,
          action: () => props.download('xlsx'),
        },
        {
          get label() {
            return t('entityActions.downloadAsCsv');
          },
          icon: FileCsv,
          action: () => props.download('csv'),
        },
      ],
    },
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: () => t('entityActions.askMacro'),
    icon: ChatWithAgentIcon,
    action: () =>
      openChatWithAgent({
        type: 'document',
        id: props.documentId,
        name: props.name(),
        fileType: 'spreadsheet',
        blockParams: props.chatContext(),
      }),
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

/** Marks spreadsheets as a beta. */
export function BetaBadge() {
  return (
    <Badge variant="outline" size="xs">
      {t('entityActions.betaBadge')}
    </Badge>
  );
}
