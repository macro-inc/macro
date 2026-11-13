import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { useUnknownHeaderTools } from '../shared/unknown-header-parts';

/** The unknown file block's header on touch: the title with its menu, and Info. */
export function MobileUnknownHeader(props: { onShare: () => void }) {
  const { ops, actions } = useUnknownHeaderTools(props.onShare);

  return (
    <MobileBlockHeader
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
    />
  );
}
