import CanvasNextDocument from '@app/features/block-canvas/canvas-next-document';
import type {
  CanvasDocumentChrome,
  CanvasDocumentMethods,
  CanvasDocumentProps,
} from '@app/features/block-canvas/component/CanvasDocument';
import type { CanvasView } from '@app/features/block-canvas/core/view';
import type { createBlockInstance as productionCreateBlockInstance } from '@core/orchestrator';
import type { JSX } from 'solid-js';

export { canNestBlock } from '@core/orchestrator';

declare global {
  interface Window {
    canvasCardControls?: {
      location: CanvasDocumentChrome['location'];
      navigate: (view: CanvasView) => void;
    };
  }
}

// Supply synthetic canvas contents in place of the block loader. Forward
// the real card's mount parameters and the legacy parent context unchanged.
export const createBlockInstance: typeof productionCreateBlockInstance = (
  type,
  id,
  options
) => ({
  type,
  id,
  key: `${type}:${id}`,
  nested: options?.nested,
  element: () => {
    const params = options?.params as Pick<CanvasDocumentProps, 'view'>;
    const parent = options?.nested?.parentContext;
    const oldCanvas = parent && 'canvas' in parent ? parent.canvas : undefined;
    const onLocationChange =
      oldCanvas &&
      typeof oldCanvas === 'object' &&
      'onLocationChange' in oldCanvas &&
      typeof oldCanvas.onLocationChange === 'function'
        ? (view: CanvasView) => {
            if (typeof oldCanvas.onLocationChange === 'function')
              oldCanvas.onLocationChange(view);
          }
        : undefined;
    let navigate: CanvasDocumentMethods['goToLocationFromParams'];
    const bind = (content: JSX.Element, chrome: CanvasDocumentChrome) => {
      window.canvasCardControls = {
        location: chrome.location,
        navigate: (view) => navigate?.(view),
      };
      return content;
    };
    return (
      <CanvasNextDocument
        documentId={id}
        initial={{
          version: 2,
          document: {
            rootId: 'canvas-root',
            items: { 'canvas-root': { id: 'canvas-root', type: 'surface' } },
          },
        }}
        canEdit={false}
        isNested
        view={params?.view}
        {...{ onLocationChange }}
        registerMethods={(methods) => {
          navigate = methods.goToLocationFromParams ?? (() => {});
        }}
      >
        {bind}
      </CanvasNextDocument>
    );
  },
});
