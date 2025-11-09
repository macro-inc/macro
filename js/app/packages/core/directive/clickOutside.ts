import { type Accessor, onCleanup } from 'solid-js';
import { longPressActivated } from './touchHandler';

type clickOutsideHandler = (e: PointerEvent | MouseEvent) => void;

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      clickOutside: clickOutsideHandler;
    }
  }
}

export default function clickOutside(
  el: HTMLElement,
  val: Accessor<clickOutsideHandler>,
  checkLongPress?: boolean
) {
  const handleDown = (e: PointerEvent | MouseEvent) => {
    const path = e.composedPath();
    const isInside = path.includes(el) || el.contains(e.target as Node);

    if (checkLongPress) {
      if (!isInside && !longPressActivated()) {
        val()(e);
      }
    } else {
      if (!isInside) {
        val()(e);
      }
    }
  };

  document.body.addEventListener('pointerdown', handleDown);
  onCleanup(() => document.body.removeEventListener('pointerdown', handleDown));
}
