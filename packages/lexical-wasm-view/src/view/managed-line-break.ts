/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalDOMSlot.ts and environment.ts managed terminators.
 * Pin: Lexical 0.45.0 / 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import type { EditorView } from './editor-view';
import type { ElementDOMSlot } from './registry';
import type { ViewNode } from './types';

interface ManagedBreak {
  readonly anchor: HTMLElement;
  readonly br: HTMLBRElement;
  readonly webkit: boolean;
}

const breaks = new WeakMap<HTMLElement, ManagedBreak>();

/** The actual owned insertion anchor; it is never a model node. */
export function managedLineBreak(element: HTMLElement): HTMLElement | null {
  return breaks.get(element)?.anchor ?? null;
}

function needsWebkitImage(element: HTMLElement): boolean {
  const window = element.ownerDocument.defaultView;
  if (!window) return false;
  const { platform, userAgent } = window.navigator;
  const apple = /Mac|iPod|iPhone|iPad/.test(platform);
  const chrome = /^(?=.*Chrome).*/i.test(userAgent);
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) && !Reflect.get(window, 'MSStream');
  const safari =
    /Version\/[\d.]+.*Safari/.test(userAgent) && !/Android/.test(userAgent);
  return (
    (/AppleWebKit\/[\d.]+/.test(userAgent) && apple && !chrome) || ios || safari
  );
}

/** Preserve the pinned Source terminator and its DOM identity across child updates. */
export function reconcileManagedLineBreak(
  view: EditorView,
  node: ViewNode,
  slot: ElementDOMSlot
): void {
  const last = view.node(node.children[node.children.length - 1]);
  const eligible =
    node.kind !== 'root' &&
    !view.flags(node)?.isInline &&
    node.type !== 'table' &&
    node.type !== 'tablerow';
  const decorator = last?.kind === 'decorator' && !!view.flags(last)?.isInline;
  const needed = eligible && (!last || last.kind === 'linebreak' || decorator);
  const previous = breaks.get(slot.element);
  const webkit = decorator && needsWebkitImage(slot.element);
  if (needed && previous?.webkit === webkit) return;

  // Capture the real suffix before retiring the current managed insertion anchor.
  const before =
    previous && slot.before === previous.anchor
      ? previous.br.nextSibling
      : slot.before;
  if (previous) {
    breaks.delete(slot.element);
    if (previous.anchor !== previous.br) previous.anchor.remove();
    previous.br.remove();
  }
  if (!needed) return;
  const document = slot.element.ownerDocument;
  const br = document.createElement('br');
  slot.element.insertBefore(br, before ?? null);
  let anchor: HTMLElement = br;
  if (webkit) {
    const image = document.createElement('img');
    image.setAttribute('data-lexical-linebreak', 'true');
    image.style.setProperty('display', 'inline', 'important');
    image.style.setProperty('border', '0px', 'important');
    image.style.setProperty('margin', '0px', 'important');
    image.alt = '';
    slot.element.insertBefore(image, br);
    anchor = image;
  }
  breaks.set(slot.element, { anchor, br, webkit });
}
