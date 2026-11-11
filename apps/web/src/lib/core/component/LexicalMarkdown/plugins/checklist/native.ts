import { EditorView } from '@macro-inc/lexical-wasm-view';
import { createNativeListenerScope } from '../../editing/overlay-hosts/native-listeners';
import { dispatchApplicationCommand } from '../group-b/command';

export function registerNativeChecklist(view: EditorView): () => void {
  let downX = 0,
    downY = 0;
  const checkboxTarget = (event: MouseEvent) => {
    if (
      view.root.contentEditable !== 'true' ||
      !(event.target instanceof HTMLElement) ||
      EditorView.fromDOM(event.target) !== view
    )
      return null;
    const key = view.keyFromDOM(event.target);
    if (key === null || view.node(key)?.type !== 'listitem') return null;
    const rem = Number.parseFloat(
      getComputedStyle(view.root.ownerDocument.documentElement).fontSize
    );
    const { left, top } = event.target.getBoundingClientRect();
    if (
      event.clientX < left - rem * 1.25 - 10 ||
      event.clientX > left + 10 ||
      event.clientY < top - 10 ||
      event.clientY > top + rem + 10
    )
      return null;
    return key;
  };
  const down = (event: PointerEvent) => {
    if (checkboxTarget(event) === null) return;
    downX = event.clientX;
    downY = event.clientY;
    event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    const key = checkboxTarget(event);
    if (
      key === null ||
      Math.abs(event.clientX - downX) >= 5 ||
      Math.abs(event.clientY - downY) >= 5
    )
      return;
    dispatchApplicationCommand(view, 'group-b.checklist', {
      action: 'toggle',
      key,
    });
  };
  const fixTabIndex = (key: number) => {
    const element = view.getElementByKey(key);
    if (element?.getAttribute('role') === 'checkbox')
      element.removeAttribute('tabindex');
  };
  for (const node of view.mirror.values()) {
    if (node.type === 'listitem') fixTabIndex(node.key);
  }
  const listeners = createNativeListenerScope();
  try {
    listeners.add(
      view.onMutations('listitem', (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation !== 'destroyed') fixTabIndex(key);
        }
      })
    );
    listeners.add(
      view.registerKeyRoute((event) => {
        const command =
          navigator.platform.startsWith('Mac') ||
          navigator.userAgent.includes('Mac')
            ? event.metaKey
            : event.ctrlKey;
        if (
          event.key !== 'Enter' ||
          !command ||
          event.shiftKey ||
          event.isComposing
        )
          return null;
        return { name: 'group-b.key', json: 'null' };
      })
    );
    listeners.add(() => view.root.removeEventListener('pointerdown', down));
    listeners.add(() => view.root.removeEventListener('click', click));
    view.root.addEventListener('pointerdown', down);
    view.root.addEventListener('click', click);
    return listeners.dispose;
  } catch (error) {
    return listeners.fail(error);
  }
}
