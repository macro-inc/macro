import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX } from 'solid-js';

/** Detail chrome floats on touch; the body owns its scrollable safe-area insets. */
export function MobileDetailFrame(props: {
  header: JSX.Element;
  children: JSX.Element;
}) {
  const [header, setHeader] = createSignal<HTMLDivElement>();
  const size = createElementSize(header);
  return (
    <div
      class="relative flex size-full min-h-0 min-w-0 flex-col"
      style={{
        '--mobile-detail-inset-top': `calc(var(--mobile-content-inset-top, 0px) + ${size.height ?? 0}px + 8px)`,
      }}
    >
      <div
        ref={setHeader}
        class="shrink-0 touch:absolute touch:inset-x-(--mobile-chrome-gutter) touch:top-(--mobile-content-inset-top) touch:z-20 touch:rounded-2xl touch:glass"
      >
        {props.header}
      </div>
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {props.children}
      </div>
    </div>
  );
}
