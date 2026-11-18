import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useUnknownHeaderTools } from '../shared/unknown-header-parts';

/** The unknown file block's header on touch: the title with its menu, and Info. */
export function MobileUnknownHeader(props: { onShare: () => void }) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, actions } = useUnknownHeaderTools(props.onShare);

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={blockId}
      name={name() ?? ''}
      iconType={blockMetadataSignal()?.fileType ?? 'unknown'}
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
    />
  );
}
