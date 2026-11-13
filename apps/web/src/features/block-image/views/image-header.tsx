import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useImageHeaderTools } from './shared/image-header-parts';

/** The image block's header on desktop. */
export function ImageHeader() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, openShare, actions } = useImageHeaderTools();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<FileTypeChip />} />
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <BlockToolbar
        tools={[actions.askMacro]}
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[actions.askMacro, actions.share]}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name() ?? ''}
      />
    </>
  );
}
