import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  BetaBadge,
  type DocxHeaderProps,
  docxHeaderTools,
} from '../shared/docx-header-parts';

/**
 * The Word block's header on touch: the title with its menu, and who
 * else is viewing. Ask Macro is in the title menu.
 */
export function MobileDocxHeader(props: DocxHeaderProps) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const title = useBlockDocumentName();
  const { ops, actions } = docxHeaderTools(props);

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={props.documentId}
      name={title() ?? ''}
      menuName={props.name()}
      iconType="write"
      trailingBadges={<BetaBadge />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
