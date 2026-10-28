import { FileDownloadButton } from '@core/component/FileDownload';
import type { FileDownloadController } from '@core/util/createFileDownload';
import { HeaderActionGroup } from './HeaderActionGroup';
import { SidePanel } from './side-panel/SidePanel';

/** Shared by Drive previews and standalone file blocks. */
export function FileDownloadHeader(props: {
  download: FileDownloadController;
}) {
  return (
    <SidePanel.HeaderActions>
      <HeaderActionGroup label="File download">
        <FileDownloadButton download={props.download} />
      </HeaderActionGroup>
    </SidePanel.HeaderActions>
  );
}
