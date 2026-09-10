import { $createInlineSearchNode } from '@lexical-core';
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';

export type AutoplayScript = {
  /** Text typed before the @ mention (must end with a space so @ triggers). */
  prefix: string;
  /** Query typed after @ to filter the menu down to the target item. */
  query: string;
  /** Text typed after the mention is inserted. */
  suffix: string;
};

/**
 * Optional post-send choreography (channel): after the mention is inserted, the
 * message "sends", a synthetic cursor clicks the pill, a doc panel slides in,
 * and a share toast appears — then it resets and loops.
 */
export type AutoplayHooks = {
  reset: () => void;
  send: () => void;
  cursorIn: () => void;
  click: () => void;
  share: () => void;
  unshare: () => void;
};

/**
 * Drives the *real* editor on a loop — types a message, opens the genuine
 * @-mention menu, filters it, selects the top match (inserting a real mention
 * pill), then resets. It never focuses the editor (so it can't steal focus on
 * the marketing page) and stops the moment the visitor actually interacts.
 */
export function runAutoplay(editor: LexicalEditor, script: AutoplayScript, hooks?: AutoplayHooks): () => void {
  let stopped = false;
  // Active = on-screen. The parent page posts pause/play as the iframe scrolls
  // in and out of view, so off-screen embeds don't fight over focus. Standalone
  // (no parent messages) just stays active.
  let active = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const shouldRun = () => !stopped && active;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });

  const contentEditable = () =>
    document.querySelector<HTMLElement>('.live-editor-shell [contenteditable]');

  // Point the DOM selection at the end of the editor so the mention menu's
  // selection-anchored positioning has a rect to point at, without taking focus
  // away from the marketing page. A *collapsed* range at the very end often
  // returns an empty/garbage rect right after a DOM mutation (which makes the
  // menu mis-place or open in the wrong direction), so anchor to the last
  // visible glyph/element instead for a stable, non-zero rect.
  const syncDomSelection = () => {
    const el = contentEditable();
    const sel = window.getSelection();
    if (!el || !sel) return;
    let node: Node = el;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    try {
      if (node.nodeType === Node.TEXT_NODE && (node as Text).length > 0) {
        const len = (node as Text).length;
        range.setStart(node, Math.max(0, len - 1));
        range.setEnd(node, len);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        range.selectNode(node);
      } else {
        range.selectNodeContents(el);
        range.collapse(false);
      }
    } catch {
      range.selectNodeContents(el);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const insertText = (text: string) =>
    editor.update(() => {
      let selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd();
        selection = $getSelection();
      }
      if ($isRangeSelection(selection)) selection.insertText(text);
    });

  const typeText = async (text: string, delay: number) => {
    for (const ch of text) {
      if (!shouldRun()) return;
      insertText(ch);
      syncDomSelection();
      await wait(delay);
    }
  };

  const clearEditor = () =>
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode());
      root.selectEnd();
    });

  const pressKey = (key: string) => {
    contentEditable()?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  // Trigger the real @ menu the same way a keystroke would, then keep the DOM
  // selection in sync for positioning.
  const openMentionMenu = () => {
    editor.update(() => {
      $getRoot().selectEnd();
      $insertNodes([$createInlineSearchNode('@')]);
    });
    syncDomSelection();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    document.removeEventListener('keydown', onRealInteraction, true);
    document.removeEventListener('pointerdown', onRealInteraction, true);
    window.removeEventListener('message', onMessage);
  };

  function onRealInteraction(e: Event) {
    if ((e as { isTrusted?: boolean }).isTrusted) stop();
  }
  document.addEventListener('keydown', onRealInteraction, true);
  document.addEventListener('pointerdown', onRealInteraction, true);

  function onMessage(e: MessageEvent) {
    const data = e.data as { type?: string; action?: string } | null;
    if (!data || data.type !== 'macro-autoplay') return;
    if (data.action === 'pause') {
      active = false;
      editor.getRootElement()?.blur();
      hooks?.reset();
    } else if (data.action === 'play') {
      active = true;
    }
  }
  window.addEventListener('message', onMessage);

  (async () => {
    await wait(900);
    while (!stopped) {
      if (!active) {
        await wait(160);
        continue;
      }
      hooks?.reset();
      clearEditor();
      await wait(180);
      await typeText(script.prefix, 42);
      if (!shouldRun()) continue;
      await wait(220);
      openMentionMenu();
      await wait(140);
      await typeText(script.query, 90);
      if (!shouldRun()) continue;
      await wait(1100); // hold the open, filtered, real menu
      pressKey('Enter'); // select the top match → real mention pill
      await wait(420);
      if (!shouldRun()) continue;
      if (hooks) {
        hooks.send(); // the composed message rises into the channel
        await wait(150);
        clearEditor(); // composer empties
        await wait(780);
        if (!shouldRun()) continue;
        hooks.cursorIn(); // synthetic cursor glides to the pill
        await wait(640);
        hooks.click(); // click ring pulses
        await wait(360);
        if (!shouldRun()) continue;
        hooks.share(); // doc panel slides in + share toast
        await wait(3400);
        if (!shouldRun()) continue;
        hooks.unshare(); // panel + toast slide out
        await wait(950);
      } else {
        await typeText(script.suffix, 42);
        await wait(2900); // hold the finished message
      }
    }
  })();

  return stop;
}

export type DocRevealScript = {
  /** Text already present in the seeded doc that the phrase types in after.
   *  Used to locate the insertion point (end of the matching text node). */
  anchor: string;
  /** The phrase one collaborator types into the document, char by char. */
  phrase: string;
  /** Receives the live caret rect (viewport coords) as the phrase is typed,
   *  and null once typing finishes / pauses, so the overlay can label it. */
  onCaret: (rect: DOMRect | null) => void;
};

/**
 * Document-mode counterpart to {@link runAutoplay}: instead of a chat composer
 * loop, it makes a single remote collaborator *type* a phrase into the real
 * document once — appended to the end of the text node containing `anchor`,
 * inserted through the genuine editor so it's real CRDT content. The phrase is
 * absent from the seed, so this reads as the collaborator typing it live the
 * moment the embed scrolls into view (parent posts play/pause). Stops the
 * instant the visitor interacts; never steals focus.
 */
export function runDocReveal(editor: LexicalEditor, script: DocRevealScript): () => void {
  let stopped = false;
  let active = true; // on-screen
  let done = false; // typed the whole phrase already
  let typed = 0; // chars committed so far (survives pause/resume)
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const shouldType = () => !stopped && active && !done;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });

  const contentEditable = () =>
    document.querySelector<HTMLElement>('.live-editor-shell [contenteditable]');

  // The DOM text node that currently holds the anchor (plus whatever has been
  // typed so far, since the phrase appends to it).
  const anchorTextNode = (): Text | null => {
    const el = contentEditable();
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: walker iteration
    while ((node = walker.nextNode())) {
      if ((node.textContent ?? '').includes(script.anchor)) return node as Text;
    }
    return null;
  };

  // Park the Lexical selection at the end of the anchor's text node so the next
  // insertText lands in the right place (the bullet isn't the doc's end).
  const placeCaretAtAnchorEnd = (): boolean => {
    let ok = false;
    editor.update(() => {
      const dom = anchorTextNode();
      if (!dom) return;
      const lexNode = $getNearestNodeFromDOMNode(dom);
      if ($isTextNode(lexNode)) {
        const len = lexNode.getTextContentSize();
        lexNode.select(len, len);
        ok = true;
      }
    });
    return ok;
  };

  const insertChar = (ch: string) =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(ch);
    });

  // Caret rect = collapsed range at the end of the anchor text node (i.e. right
  // after the last typed glyph), in viewport coords for the overlay to convert.
  const caretRect = (): DOMRect | null => {
    const dom = anchorTextNode();
    if (!dom) return null;
    const range = document.createRange();
    const len = dom.length;
    range.setStart(dom, len);
    range.setEnd(dom, len);
    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  };

  // Human-ish cadence: brief pause after spaces, longer after a sentence end.
  const delayFor = (ch: string) => {
    if (ch === '.') return 260;
    if (ch === ' ') return 90;
    return 34 + Math.random() * 46;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    document.removeEventListener('keydown', onRealInteraction, true);
    document.removeEventListener('pointerdown', onRealInteraction, true);
    window.removeEventListener('message', onMessage);
  };

  function onRealInteraction(e: Event) {
    if ((e as { isTrusted?: boolean }).isTrusted) stop();
  }
  document.addEventListener('keydown', onRealInteraction, true);
  document.addEventListener('pointerdown', onRealInteraction, true);

  function onMessage(e: MessageEvent) {
    const data = e.data as { type?: string; action?: string } | null;
    if (!data || data.type !== 'macro-autoplay') return;
    if (data.action === 'pause') {
      active = false;
      editor.getRootElement()?.blur();
    } else if (data.action === 'play') {
      active = true;
    }
  }
  window.addEventListener('message', onMessage);

  (async () => {
    await wait(700); // beat after the doc settles / scrolls into view
    while (!stopped && !done) {
      if (!active) {
        await wait(160);
        continue;
      }
      if (!placeCaretAtAnchorEnd()) {
        await wait(150);
        continue;
      }
      while (typed < script.phrase.length) {
        if (!shouldType()) break; // paused / interrupted → outer loop waits
        insertChar(script.phrase[typed]);
        typed += 1;
        script.onCaret(caretRect());
        await wait(delayFor(script.phrase[typed - 1]));
      }
      if (typed >= script.phrase.length) {
        done = true;
        script.onCaret(null);
        // The static overlay only recomputes on resize/poll; nudge it so the
        // now-complete phrase picks up the collaborator's selection highlight.
        window.dispatchEvent(new Event('resize'));
      }
    }
  })();

  return stop;
}
