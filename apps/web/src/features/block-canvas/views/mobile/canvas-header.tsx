import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import type { CanvasDocumentChrome } from '../../component/CanvasDocument';
import { useCanvasHeaderTools } from '../shared/canvas-header-parts';

/** The canvas block's header on touch: the title with its menu, and Info. */
export function MobileCanvasHeader(props: { state: CanvasDocumentChrome }) {
  const { ops, actions } = useCanvasHeaderTools(props.state);

  return (
    <MobileBlockHeader
      fallbackName="Unknown Filename"
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
