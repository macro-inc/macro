import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  type FigHeaderProps,
  figHeaderTools,
} from '../shared/fig-header-parts';

/**
 * The fig block's header on touch: the title with its menu, and who else
 * is viewing.
 */
export function MobileFigHeader(props: FigHeaderProps) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Design');
  const { ops, actions } = figHeaderTools(props);

  return (
    <MobileBlockHeader
      id={documentId}
      name={name() ?? ''}
      iconType="fig"
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
