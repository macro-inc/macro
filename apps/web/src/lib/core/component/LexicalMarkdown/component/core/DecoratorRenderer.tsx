import type { LexicalEditor, NodeKey } from 'lexical';
import { type Component, createMemo, For, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic, Portal } from 'solid-js/web';
import { MarkdownStackingContext } from '../../constants';

type Decorator = [HTMLElement, Component];
type DecoratorMap = Record<NodeKey, Decorator>;
type DecoratorItem = {
  key: NodeKey;
  mountRef: HTMLElement;
  component: Component;
};

/**
 * Filter the decorators we get from Lexical to the ones we can render.
 */
function validDecorators(
  editor: LexicalEditor,
  decorators: Record<string, any>
): DecoratorMap {
  const nextDecorators: DecoratorMap = {};
  for (const key in decorators) {
    const mountRef = editor.getElementByKey(key);
    if (!mountRef) continue;
    const component = decorators[key];
    if (!(component instanceof Function)) continue;
    if (mountRef) {
      nextDecorators[key] = [mountRef, component as Component];
    }
  }
  return nextDecorators;
}

export function DecoratorRenderer(props: { editor: LexicalEditor }) {
  const [decoratorItems, setDecoratorItems] = createStore<
    Record<NodeKey, DecoratorItem>
  >({});

  const cleanup = props.editor.registerDecoratorListener((rawDecorators) => {
    const incomingDecorators = validDecorators(props.editor, rawDecorators);
    for (const key in incomingDecorators) {
      const [mountRef, component] = incomingDecorators[key];

      // Solid portals render wrapped in a div that cannot be targeted with JSX.
      // This is a workaround that targets the first-div-child of the mount ref
      // (which is the portal) so we can add "display: contents" to transparently
      // render the component in the portal.
      mountRef.classList.add('__decorator-mount-ref');

      setDecoratorItems(key, {
        key,
        mountRef,
        component,
      });
    }

    for (const key in decoratorItems) {
      if (!incomingDecorators[key]) {
        setDecoratorItems(key, undefined!);
      }
    }
  });

  onCleanup(cleanup);

  const list = createMemo(() => {
    return Object.values(decoratorItems);
  });

  return (
    <div
      class="__decorators"
      style={{ 'z-index': MarkdownStackingContext.Decorators }}
    >
      <For each={list()}>
        {(item) => {
          return (
            <Portal mount={item.mountRef}>
              <Dynamic component={item.component} />
            </Portal>
          );
        }}
      </For>
    </div>
  );
}
