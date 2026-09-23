import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import DownloadSimple from '@phosphor/download-simple.svg';

export function downloadFileOperation(action: () => void): FileOperation {
  return {
    group: 'file',
    label: 'Download',
    icon: DownloadSimple,
    action,
  };
}
