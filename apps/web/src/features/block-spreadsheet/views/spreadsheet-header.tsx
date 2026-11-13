import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import {
  BetaBadge,
  type SpreadsheetHeaderProps,
  spreadsheetHeaderTools,
} from './shared/spreadsheet-header-parts';

/**
 * The spreadsheet block's header on desktop. Ask Macro and Comments come
 * from the editor, which needs the sheet's store.
 */
export function SpreadsheetHeader(props: SpreadsheetHeaderProps) {
  const { ops, actions } = spreadsheetHeaderTools(props);

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel trailingBadges={<BetaBadge />} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        trailing={<ShareTrigger onClick={props.openShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={props.documentId}
        itemType="document"
        name={props.name()}
      />
    </>
  );
}
