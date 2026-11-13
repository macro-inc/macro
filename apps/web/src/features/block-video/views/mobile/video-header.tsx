import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { FileDownloadButton } from '@core/component/FileDownload';
import { useVideoHeaderTools } from '../shared/video-header-parts';

/**
 * The video block's header on touch: the title with its menu, Download, and
 * Info.
 */
export function MobileVideoHeader() {
  const { ops, download, actions } = useVideoHeaderTools();

  return (
    <MobileBlockHeader
      menuTools={[actions.share]}
      ops={ops}
      trailing={
        <MobileHeader.Island>
          <FileDownloadButton grouped download={download} />
        </MobileHeader.Island>
      }
    />
  );
}
