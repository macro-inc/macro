import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type AiHeaderProps, aiHeaderTools } from '../shared/ai-header-parts';

/**
 * The ai block's header on touch: the title with its menu, and who else
 * is viewing.
 */
export function MobileAiHeader(props: AiHeaderProps) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const documentId = useBlockId();
  const title = useBlockDocumentName();
  const name = useBlockDocumentName('Illustration');
  const { ops, actions } = aiHeaderTools(props);

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={documentId}
      name={title() ?? ''}
      menuName={name() ?? ''}
      iconType="ai"
      badges={<FileTypeChip />}
      menuTools={[actions.share]}
      ops={ops}
      trailing={<BlockLiveIndicators />}
    />
  );
}
