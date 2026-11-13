import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useImageHeaderTools } from '../shared/image-header-parts';

/** The image block's header on touch: the title with its menu, and Info. */
export function MobileImageHeader() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, actions } = useImageHeaderTools();

  return (
    <MobileBlockHeader
      id={blockId}
      name={name() ?? ''}
      iconType="image"
      badges={<FileTypeChip />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
