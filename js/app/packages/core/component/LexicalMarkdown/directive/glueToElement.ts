import { autoUpdate, computePosition, hide } from '@floating-ui/dom';
import type { LexicalEditor } from 'lexical';
import type { Accessor, JSX } from 'solid-js';
import { createEffect, onCleanup } from 'solid-js';

export type GlueToElementProps = {
  editor: LexicalEditor;
  element: Accessor<HTMLElement | undefined | null>;
};

// Add to type definitions
declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      glueToElement: GlueToElementProps;
    }
  }
}

function style(el: HTMLElement, styles: Partial<JSX.CSSProperties>) {
  Object.assign(el.style, styles);
}

/**
 * Glues one element to another one as children of a lexical editor. Useful for attaching
 * floating elements to a LexicalEditor without inserting them into the content editable
 * lexical-managed DOM.
 */
export function glueToElement(
  floatingElement: HTMLElement,
  propAccessor: () => GlueToElementProps
) {
  style(floatingElement, { position: 'absolute' });

  let cleanupAutoUpdate: () => void = () => {};

  async function updatePosition() {
    const el = propAccessor().element();
    const root = propAccessor().editor.getRootElement();

    if (!el || !root) {
      style(floatingElement, { display: 'none' });
      return;
    }

    const { middlewareData } = await computePosition(el, floatingElement, {
      middleware: [hide()],
    });

    const rect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const offsetLeft = rect.left - rootRect.left;
    const offsetTop = rect.top - rootRect.top;

    style(floatingElement, {
      left: `${offsetLeft}px`,
      top: `${offsetTop}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
    });
  }

  createEffect(() => {
    cleanupAutoUpdate();
    const referenceEl = propAccessor().element() ?? null;
    if (!referenceEl) return;
    cleanupAutoUpdate = autoUpdate(
      referenceEl,
      floatingElement,
      updatePosition
    );
  });

  onCleanup(() => {
    cleanupAutoUpdate();
  });
}
