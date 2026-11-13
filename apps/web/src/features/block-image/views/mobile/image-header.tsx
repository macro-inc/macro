import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { useImageHeaderTools } from '../shared/image-header-parts';

/** The image block's header on touch: the title with its menu, and Info. */
export function MobileImageHeader() {
  const { ops, actions } = useImageHeaderTools();

  return (
    <MobileBlockHeader
      badges={<FileTypeChip />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
