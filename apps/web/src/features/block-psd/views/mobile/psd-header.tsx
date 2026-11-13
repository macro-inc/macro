import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  type PsdHeaderProps,
  psdHeaderTools,
} from '../shared/psd-header-parts';

/**
 * The psd block's header on touch: the title with its menu, and who else
 * is viewing.
 */
export function MobilePsdHeader(props: PsdHeaderProps) {
  const documentId = useBlockId();
  const title = useBlockDocumentName();
  const name = useBlockDocumentName('Image');
  const { ops, actions } = psdHeaderTools(props);

  return (
    <MobileBlockHeader
      id={documentId}
      name={title() ?? ''}
      menuName={name() ?? ''}
      iconType="psd"
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
