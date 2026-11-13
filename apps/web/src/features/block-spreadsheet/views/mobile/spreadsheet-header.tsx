import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { isMobile } from '@core/mobile/isMobile';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Show } from 'solid-js';
import {
  BetaBadge,
  type SpreadsheetHeaderProps,
  spreadsheetHeaderTools,
} from '../shared/spreadsheet-header-parts';

/**
 * The spreadsheet block's header on touch: the title with its menu (and the
 * Beta badge on tablets), and who else is viewing. While it owns the header,
 * the editor's Ask Macro and Comments buttons don't reach it; Ask Macro
 * is in the title menu.
 */
export function MobileSpreadsheetHeader(props: SpreadsheetHeaderProps) {
  const title = useBlockDocumentName();
  const { ops, actions } = spreadsheetHeaderTools(props);

  return (
    <MobileBlockHeader
      id={props.documentId}
      name={title() ?? ''}
      menuName={props.name()}
      iconType="spreadsheet"
      trailingBadges={
        <Show when={!isMobile()}>
          <BetaBadge />
        </Show>
      }
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
