import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
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
}

/** The spreadsheet block's title menu operations and named header actions. */
export function spreadsheetHeaderTools(props: SpreadsheetHeaderProps) {
  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadSimple,
      children: [
        {
          label: 'Download as Excel (.xlsx)',
          icon: FileXls,
          action: () => props.download('xlsx'),
        },
        {
          label: 'Download as CSV',
          icon: FileCsv,
          action: () => props.download('csv'),
        },
      ],
    },
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () =>
      openChatWithAgent({
        type: 'document',
        id: props.documentId,
        name: props.name(),
        fileType: 'spreadsheet',
      }),
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

/** Marks spreadsheets as a beta. */
export function BetaBadge() {
  return (
    <Badge variant="outline" size="xs">
      Beta
    </Badge>
  );
}
