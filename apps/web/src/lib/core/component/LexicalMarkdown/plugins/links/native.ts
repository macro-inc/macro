import { EditorView } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';
import type { ILinkInfo } from './linksPlugin';

export type NativeLinkCallbacks = {
  open(url: string): void;
  isTouchDevice(): boolean;
  onHoverLink?(info?: ILinkInfo): void;
  onClickLink?(info?: ILinkInfo): void;
};

/** DOM hover/navigation uses mirror-owned anchors; link mutation stays native. */
export function registerNativeLinks(
  view: EditorView,
  callbacks: NativeLinkCallbacks
) {
  let hovered: HTMLElement | undefined;
  const read = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement) || EditorView.fromDOM(target) !== view)
      return null;
    const anchor = target.closest('a');
    if (!anchor || anchor.classList.contains('internal-link')) return null;
    return {
      linkRef: target,
      url: anchor.getAttribute('href') ?? '',
      linkText: anchor.textContent ?? '',
      editAccess: view.root.contentEditable === 'true',
    };
  };
  const click = (event: MouseEvent) => {
    const link = read(event.target);
    if (!link) return;
    if (link.editAccess) {
      if (event.metaKey || event.ctrlKey) callbacks.open(link.url);
      callbacks.onClickLink?.({
        ...link,
        selection: view.root.ownerDocument.getSelection(),
      });
    } else {
      event.preventDefault();
      event.stopPropagation();
      callbacks.open(link.url);
    }
  };
  const move = (event: PointerEvent) => {
    if (callbacks.isTouchDevice()) return;
    const link = read(event.target);
    if (!link) {
      hovered = undefined;
      callbacks.onHoverLink?.();
      return;
    }
    if (hovered !== link.linkRef) {
      hovered = link.linkRef;
      callbacks.onHoverLink?.(link);
    }
  };
  const leave = () => {
    hovered = undefined;
    callbacks.onHoverLink?.();
  };
  view.root.addEventListener('click', click);
  view.root.addEventListener('pointermove', move);
  view.root.addEventListener('pointerleave', leave);
  return () => {
    view.root.removeEventListener('click', click);
    view.root.removeEventListener('pointermove', move);
    view.root.removeEventListener('pointerleave', leave);
    leave();
  };
}

export function insertNativeLink(view: EditorView, url: string, label: string) {
  return dispatchApplicationCommand(view, 'group-b.link', {
    action: 'insert',
    url,
    label,
  });
}
export function updateNativeLink(view: EditorView, url: string, label: string) {
  return dispatchApplicationCommand(view, 'group-b.link', {
    action: 'update',
    url,
    label,
  });
}
export function updateNativeLinkUrl(view: EditorView, url: string | null) {
  return dispatchApplicationCommand(view, 'group-b.link', {
    action: 'url',
    url,
  });
}
export function unlinkNativeSelection(view: EditorView) {
  return dispatchApplicationCommand(view, 'group-b.link', { action: 'unlink' });
}
