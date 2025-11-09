import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { MarkdownStackingContext } from '../../constants';
import type { AccessoryStore } from '../../plugins/node-accessory/nodeAccessoryPlugin';
import { lazyRegister } from '../../plugins/shared/utils';

export function NodeAccessoryRenderer(props: {
  editor: LexicalEditor;
  store: AccessoryStore;
}) {
  const [editorRootParent, setEditorRootParent] = createSignal<HTMLElement>();
  lazyRegister(
    () => props.editor,
    (editor) => {
      return mergeRegister(
        editor.registerRootListener((root) => {
          if (root !== null && root!.parentElement !== null) {
            setEditorRootParent(root.parentElement);
            return;
          }
          setEditorRootParent();
        })
      );
    }
  );

  const list = createMemo(() => {
    return Object.values(props.store);
  });

  return (
    <Show when={editorRootParent()}>
      {(parent) => (
        <Portal mount={parent()}>
          <div
            class="__node-accessories absolute top-0 left-0"
            style={{ 'z-index': MarkdownStackingContext.Accessories }}
          >
            <For each={list()}>
              {(item) => {
                return (
                  <Dynamic
                    component={() =>
                      item.component({ ref: item.mountRef, key: item.key })
                    }
                  />
                );
              }}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}
