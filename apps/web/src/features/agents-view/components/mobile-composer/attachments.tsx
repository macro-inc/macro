import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createSignal, type ParentProps } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerAttachments(props: ParentProps) {
  const state = useMobileComposer();
  const [element, setElement] = createSignal<HTMLDivElement>();
  createResizeObserver(element, (_, node) =>
    state.setAttachmentHeight(node.getBoundingClientRect().height)
  );
  return (
    <div
      ref={setElement}
      class="phone-composer-attachments w-full min-w-0 empty:hidden"
      inert={state.collapsed()}
      aria-hidden={state.collapsed()}
    >
      {props.children}
    </div>
  );
}
