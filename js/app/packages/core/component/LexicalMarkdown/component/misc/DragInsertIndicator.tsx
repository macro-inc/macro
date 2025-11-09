import { Show, useContext } from 'solid-js';
import type { Store } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { DragInsertState } from '../../plugins';

export function DragInsertIndicator(props: {
  state: Store<DragInsertState>;
  active: boolean;
}) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;

  const elementRect = () => {
    const key = props.state.nodeKey;
    if (key !== null) {
      const element = editor()?.getElementByKey(key);
      if (element) {
        return element.getBoundingClientRect();
      }
    }
  };

  const derivedRect = () => {
    const padding = props.state.visible ? 6 : 0;
    const r = elementRect() ?? { top: 0, left: 0, width: 0, height: 0 };
    const rootRect = editor()?.getRootElement()?.getBoundingClientRect();
    return {
      top:
        (props.state.position === 'before'
          ? r.top - padding
          : r.top + r.height + padding) + 'px',
      left: (rootRect?.left ?? r.left) + 'px',
      width: (rootRect?.width ?? r.width) + 'px',
      height: 2 + 'px',
    };
  };

  return (
    <Show when={props.active}>
      <Portal>
        <div
          class="invisible fixed bg-accent/60 pointer-events-none rounded-full ring-6 ring-accent/10 transition-all duration-100 ease-in-out"
          classList={{
            visible: props.state.visible,
          }}
          style={{ ...derivedRect() }}
        />
      </Portal>
    </Show>
  );
}
