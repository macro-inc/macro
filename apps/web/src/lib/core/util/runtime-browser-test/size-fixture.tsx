import { createElementSize } from '@core/util/createElementSize';
import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

function Fixture() {
  const [element, setElement] = createSignal<HTMLDivElement>();
  const [border, setBorder] = createSignal(6);
  const size = createElementSize(element);
  let firstMeasurement: number | undefined;
  createEffect(() => {
    if (size.width === null) return;
    firstMeasurement ??= performance.now();
    document.body.dataset.firstMeasurement = String(firstMeasurement);
  });
  return (
    <>
      <div
        ref={setElement}
        id="measured"
        style={{
          width: '50vw',
          height: '120px',
          padding: '16px',
          border: `${border()}px solid black`,
          transform: 'scale(0.75)',
          'transform-origin': 'top left',
          'box-sizing': 'content-box',
        }}
      >
        Measured border box
      </div>
      <output
        id="size"
        data-width={size.width}
        data-height={size.height}
        data-layout={
          size.width === null ? 'pending' : size.width > 500 ? 'wide' : 'narrow'
        }
      >
        {size.width} × {size.height}
      </output>
      <button onClick={() => setBorder(12)}>Grow border</button>
    </>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
