import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  type PptxHeaderProps,
  pptxHeaderTools,
} from '../shared/pptx-header-parts';

/**
 * The slides block's header on touch: the title with its menu, and who
 * else is viewing. Ask Macro is in the title menu.
 */
export function MobilePptxHeader(props: PptxHeaderProps) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const title = useBlockDocumentName();
  const { ops, actions } = pptxHeaderTools(props);

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={props.documentId}
      name={title() ?? ''}
      menuName={props.name()}
      iconType="pptx"
      badges={<FileTypeChip />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
