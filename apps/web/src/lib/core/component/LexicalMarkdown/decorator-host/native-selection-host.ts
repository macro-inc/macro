import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import { createSignal, onCleanup } from 'solid-js';
import type { DecoratorSelectionHost } from './selection-host';

/** Observe actual acknowledged view selection within this component's lifetime. */
export function createNativeSelectionHost(
  props: DecoratorProps
): DecoratorSelectionHost {
  const key = props.node().key;
  const generation = props.view.mirror.keyGeneration;
  if (generation === null)
    throw new Error('Native decorator has no acknowledged key generation');
  const [selection, setSelection] = createSignal(
    props.view.selection().selection
  );
  let alive = true;
  const release = props.view.onCommit(() =>
    setSelection(props.view.selection().selection)
  );
  onCleanup(() => {
    alive = false;
    release();
  });
  return {
    isSelected(sourceKey) {
      if (
        !alive ||
        props.view.mirror.keyGeneration !== generation ||
        sourceKey !== String(key) ||
        props.view.node(key) === null
      )
        return false;
      const current = selection();
      return current.kind === 'node' && current.keys.includes(key);
    },
  };
}
