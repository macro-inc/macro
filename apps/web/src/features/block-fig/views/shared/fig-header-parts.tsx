import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { fireAndForget } from '@core/util/fireAndForget';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';

export interface FigHeaderProps {
  openShare: () => void;
  download: () => Promise<void>;
}

/** The fig block's title menu operations and named header actions. */
export function figHeaderTools(props: FigHeaderProps) {
  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadSimple,
      action: () => fireAndForget(props.download(), 'fig-viewer'),
    },
    { op: 'delete' },
  ];

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: props.openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, actions: { share } };
}
