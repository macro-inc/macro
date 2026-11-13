import { BlockToolbar } from '@components/app/block-toolbar';
import { FileDownloadHeader } from '@components/app/FileDownloadHeader';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useVideoHeaderTools } from './shared/video-header-parts';

/** The video block's header on desktop. */
export function VideoHeader() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, download, openShare, actions } = useVideoHeaderTools();

  return (
    <>
      <FileDownloadHeader download={download} />
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <BlockToolbar
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name() ?? ''}
      />
    </>
  );
}
