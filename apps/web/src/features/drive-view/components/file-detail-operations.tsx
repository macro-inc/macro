import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import DownloadSimple from '@icon/system/regular/download-simple.svg';

export function downloadFileOperation(action: () => void): FileOperation {
  return {
    group: 'share-export',
    label: 'Download',
    icon: DownloadSimple,
    action,
  };
}
