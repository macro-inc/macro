import type {
  DecoratorProps,
  EditorView,
  MacroDecorators,
} from '@macro-inc/lexical-wasm-view';
import {
  type Accessor,
  createComponent,
  createSignal,
  onCleanup,
} from 'solid-js';
import { HorizontalRule } from '../component/decorator/HorizontalRule';
import type { HorizontalRuleHost } from '../context/DecoratorHostContext';
import { dispatchApplicationCommand } from '../plugins/group-b/command';

const NO_SELECTED_KEYS: readonly number[] = [];

function selectedKeys(view: EditorView | undefined): readonly number[] {
  const selection = view?.selection().selection;
  return selection?.kind === 'node' ? selection.keys : NO_SELECTED_KEYS;
}

/** Real view capabilities for the shared horizontal-rule component. */
export function createNativeHorizontalRuleHost(
  view: Accessor<EditorView | undefined>,
  selection: Accessor<readonly number[]> = () => selectedKeys(view())
): HorizontalRuleHost {
  const target = (current: EditorView, key: string) => {
    const index = Number(key);
    if (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(index))
      return null;
    return current.node(index) ?? null;
  };
  const isSelected = (key: string) => {
    const current = view();
    if (!current) return false;
    const node = target(current, key);
    return !!node && selection().includes(node.key);
  };
  return {
    isSelected,
    isEditable: () => view()?.root.contentEditable === 'true',
    horizontalRule: {
      select(key) {
        const current = view();
        if (!current) return;
        const node = target(current, key);
        if (!node || isSelected(key)) return;
        current.port.selectionFromView({ kind: 'node', keys: [node.key] });
      },
      remove(key) {
        const current = view();
        if (!current) return;
        const node = target(current, key);
        if (node)
          dispatchApplicationCommand(current, 'group-b.decorator-delete', {
            key: node.key,
          });
      },
    },
  };
}

/** Merge this actual component into the complete strict Macro registry. */
export function createNativeHorizontalRuleViews(
  bindView: (view: EditorView) => void
): Pick<MacroDecorators, 'horizontalrule'> {
  const selections = new WeakMap<
    EditorView,
    {
      keys: Accessor<readonly number[]>;
      detach: () => void;
      users: number;
    }
  >();
  return {
    horizontalrule(props: DecoratorProps) {
      bindView(props.view);
      const generation = props.view.mirror.keyGeneration;
      let shared = selections.get(props.view);
      if (!shared) {
        const [keys, setKeys] = createSignal(selectedKeys(props.view));
        shared = {
          keys,
          detach: props.view.onCommit(() => setKeys(selectedKeys(props.view))),
          users: 0,
        };
        selections.set(props.view, shared);
      }
      const selection = shared;
      selection.users++;
      let active = true;
      onCleanup(() => {
        active = false;
        selection.users--;
        if (selection.users === 0) {
          selection.detach();
          selections.delete(props.view);
        }
      });
      const host = createNativeHorizontalRuleHost(
        () =>
          active && props.view.mirror.keyGeneration === generation
            ? props.view
            : undefined,
        selection.keys
      );
      return createComponent(HorizontalRule, {
        host,
        get key() {
          return String(props.node().key);
        },
      });
    },
  };
}
