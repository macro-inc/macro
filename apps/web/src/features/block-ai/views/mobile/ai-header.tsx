import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type AiHeaderProps, aiHeaderTools } from '../shared/ai-header-parts';

/**
 * The ai block's header on touch: the title with its menu, and who else
 * is viewing.
 */
export function MobileAiHeader(props: AiHeaderProps) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Illustration');
  const { ops, actions } = aiHeaderTools(props);

  return (
    <MobileBlockHeader
      id={documentId}
      name={name() ?? ''}
      iconType="ai"
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
