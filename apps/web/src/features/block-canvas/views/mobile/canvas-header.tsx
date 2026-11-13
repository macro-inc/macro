import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockId } from '@core/block';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { CanvasDocumentChrome } from '../../component/CanvasDocument';
import { useCanvasHeaderTools } from '../shared/canvas-header-parts';

/** The canvas block's header on touch: the title with its menu, and Info. */
export function MobileCanvasHeader(props: { state: CanvasDocumentChrome }) {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const { ops, actions } = useCanvasHeaderTools(props.state);

  return (
    <MobileBlockHeader
      id={documentId}
      name={fileName()}
      iconType="canvas"
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
