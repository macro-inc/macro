import { placeableModeSignal } from '@block-pdf/signal/placeables';
import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { PayloadMode, type PayloadType } from '../type/placeables';

const modeToCursor: Record<PayloadType, string> = {
  [PayloadMode.TextBox]: 'Text Box',
  [PayloadMode.FreeTextAnnotation]: 'Text Annotation',
  [PayloadMode.Shape]: 'Shape',
  [PayloadMode.ShapeAnnotation]: 'Shape Annotation',
  [PayloadMode.Image]: 'Image',
  [PayloadMode.Bookmark]: 'Bookmark',
  [PayloadMode.FreeComment]: 'Comment',
  [PayloadMode.Thread]: 'Comment',
  [PayloadMode.PageNumber]: 'Page Numbers',
  [PayloadMode.Signature]: 'Signature',
  [PayloadMode.Watermark]: 'Watermark',
  [PayloadMode.HeaderFooter]: 'Header or Footer',
  [PayloadMode.Redact]: 'Redact',
  [PayloadMode.NoMode]: '',
};

export function CustomCursor(props: { containerRef?: HTMLDivElement }) {
  const containerRef = () => props.containerRef;
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const [mode] = placeableModeSignal;

  const mouseMoveHandler: JSX.EventHandler<Document, MouseEvent> = ({ x, y }) =>
    setPos({ x, y });

  createEffect(() => {
    const container = containerRef();
    if (!container) return;
    container.addEventListener('mousemove', mouseMoveHandler);

    onCleanup(() =>
      container.removeEventListener('mousemove', mouseMoveHandler)
    );
  });

  return (
    <Show when={containerRef() && mode() !== PayloadMode.NoMode}>
      <div
        class="dot absolute z-custom-cursor-tooltip"
        style={{
          left: `${pos().x + 10}px`,
          top: `${pos().y + 50}px`,
        }}
      >
        {modeToCursor[mode()]}
      </div>
    </Show>
  );
}
