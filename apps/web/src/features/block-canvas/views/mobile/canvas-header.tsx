import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { CanvasDocumentChrome } from '../../component/CanvasDocument';
import { useCanvasHeaderTools } from '../shared/canvas-header-parts';

/** The canvas block's header on touch: the title with its menu, and Info. */
export function MobileCanvasHeader(props: { state: CanvasDocumentChrome }) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const { ops, actions } = useCanvasHeaderTools(props.state);

  return (
    <MobileBlockHeader
      entityKind={entityKind}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={documentId}
      name={fileName()}
      iconType="canvas"
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
