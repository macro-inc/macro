import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useImageHeaderTools } from '../shared/image-header-parts';

/** The image block's header on touch: the title with its menu, and Info. */
export function MobileImageHeader() {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, actions } = useImageHeaderTools();

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={blockId}
      name={name() ?? ''}
      iconType="image"
      badges={<FileTypeChip />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
