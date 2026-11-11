import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDraggableBlockStore,
  draggableBlockPlugin,
} from './draggableBlockPlugin';

const RECT = { left: 100, right: 500, top: 100, bottom: 400 };

function mountEditor(host: HTMLElement) {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  host.appendChild(root);
  document.body.appendChild(host);

  const editor = createEditor({ onError: (error) => Promise.reject(error) });
  editor.setRootElement(root);
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('a')));
    },
    { discrete: true }
  );

  // jsdom has no layout: computed margins are empty unless set, and the root
  // and its paragraph share one rect.
  root.querySelector('p')?.style.setProperty('margin', '0px');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({
      x: RECT.left,
      y: RECT.top,
      width: RECT.right - RECT.left,
      height: RECT.bottom - RECT.top,
    })
  );

  const [state, setState] = createDraggableBlockStore();
  const cleanup = draggableBlockPlugin({ setState })(editor);
  return { state, cleanup, root };
}

function hoverInsideEditor(target: HTMLElement) {
  target.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 200 })
  );
  vi.runAllTimers();
}

describe('draggableBlockPlugin', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the handle for the block under the cursor', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    const { state, cleanup } = mountEditor(document.createElement('div'));

    hoverInsideEditor(document.body);

    expect(state.hoveredElement?.tagName).toBe('P');
    cleanup();
  });

  it('ignores an editor inside an inert layer covered by visible content', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    const parked = document.createElement('div');
    parked.setAttribute('inert', '');
    const { state, cleanup } = mountEditor(parked);

    hoverInsideEditor(document.body);

    expect(state.hoveredElement).toBeNull();
    cleanup();
  });
});
