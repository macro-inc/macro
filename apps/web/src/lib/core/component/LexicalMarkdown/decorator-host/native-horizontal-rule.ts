import type {
  DecoratorProps,
  EditorView,
  MacroDecorators,
} from '@macro-inc/lexical-wasm-view';
import { type Accessor, createComponent, onCleanup } from 'solid-js';
import { HorizontalRule } from '../component/decorator/HorizontalRule';
import type { HorizontalRuleHost } from '../context/DecoratorHostContext';
import { dispatchApplicationCommand } from '../plugins/group-b/command';

/** Real view capabilities for the shared horizontal-rule component. */
export function createNativeHorizontalRuleHost(
  view: Accessor<EditorView | undefined>
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
    const selection = current.selection().selection;
    return (
      !!node && selection.kind === 'node' && selection.keys.includes(node.key)
    );
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
  return {
    horizontalrule(props: DecoratorProps) {
      bindView(props.view);
      const generation = props.view.mirror.keyGeneration;
      let active = true;
      onCleanup(() => {
        active = false;
      });
      const host = createNativeHorizontalRuleHost(() =>
        active && props.view.mirror.keyGeneration === generation
          ? props.view
          : undefined
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
