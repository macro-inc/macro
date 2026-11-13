import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  BetaBadge,
  type DocxHeaderProps,
  docxHeaderTools,
} from '../shared/docx-header-parts';

/**
 * The Word block's header on touch: the title with its menu, and who
 * else is viewing.
 */
export function MobileDocxHeader(props: DocxHeaderProps) {
  const { ops, actions } = docxHeaderTools(props);

  return (
    <MobileBlockHeader
      id={props.documentId}
      name={props.name()}
      iconType="write"
      trailingBadges={<BetaBadge />}
      menuTools={[actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
