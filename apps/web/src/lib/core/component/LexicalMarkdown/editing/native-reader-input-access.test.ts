import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// A live demotion reaches the session before the UI editability effect: the
// view is still editable while the session is Read or CommentOnly. DOM input
// in that window must not reach the document, must not report a session
// error (RustMarkdownEditor tears the editor down on any), and must leave the
// DOM showing the authoritative document.

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-reader-input-access',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError: (error) => errors.push(error),
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'native-reader-input-access'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'body' }],
          },
        ],
      },
    })
  );
  const textKey = () => {
    const text = [...runtime.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!text) throw new Error('Missing actual native text');
    return text.key;
  };
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: textKey(), offset: 0, type: 'text' },
    focus: { key: textKey(), offset: 0, type: 'text' },
  });
  const leaf = () => {
    const element = runtime.view.getElementByKey(textKey());
    const node = element?.firstChild;
    if (!(node instanceof Text)) throw new Error('Missing actual text leaf');
    return node;
  };
  /** A DOM caret the view has not yet published, as after a click or arrow. */
  const moveDomCaret = (offset: number) => {
    const node = leaf();
    document.getSelection()?.setBaseAndExtent(node, offset, node, offset);
  };
  const authorize = (write: boolean, comment: boolean) =>
    runtime.executor.run(() =>
      runtime.executor.session.authorization(
        true,
        write,
        comment,
        runtime.executor.now(),
        Date.now()
      )
    );
  const key = (k: string) =>
    runtime.view.root.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
  /** After regrant, an ordinary edit still lands without errors. */
  const expectHealthyEdit = () => {
    authorize(true, true);
    expect(runtime.executor.session.effectiveAccess()).toBe(Access.Edit);
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: textKey(), offset: 4, type: 'text' },
      focus: { key: textKey(), offset: 4, type: 'text' },
    });
    runtime.port.command(CommandCode.InsertText, 0, 0, '!');
    expect(errors).toEqual([]);
    expect(root.textContent).toBe('body!');
  };
  return {
    ...runtime,
    root,
    errors,
    leaf,
    moveDomCaret,
    authorize,
    key,
    expectHealthyEdit,
    async close() {
      await runtime.close();
      root.remove();
    },
  };
}

for (const [label, comment, access] of [
  ['view-only', false, Access.Read],
  ['comment-only', true, Access.CommentOnly],
] as const) {
  describe(`${label} session, UI still editable`, () => {
    const demoted = async (body: (r: ReturnType<typeof mount>) => void) => {
      const r = mount();
      try {
        r.authorize(false, comment);
        expect(r.executor.session.effectiveAccess()).toBe(access);
        expect(r.view.isEditable).toBe(true);
        const before = r.view.query.serializedState();
        body(r);
        expect(r.errors).toEqual([]);
        expect(r.view.query.serializedState()).toBe(before);
        expect(r.root.textContent).toBe('body');
        r.expectHealthyEdit();
      } finally {
        await r.close();
      }
    };

    test('a character key after a caret move is not submitted', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        r.key('@');
      }));

    test('an arrow key after a caret move is not submitted', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        r.key('ArrowRight');
      }));

    test('a plain insertText left to the browser is not submitted and is repaired', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        const event = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true,
        });
        r.root.dispatchEvent(event);
        // A plain character is left to the browser (not prevented); model it.
        if (!event.defaultPrevented) {
          r.leaf().nodeValue = 'boxdy';
          r.moveDomCaret(3);
          r.root.dispatchEvent(
            new InputEvent('input', {
              inputType: 'insertText',
              data: 'x',
              bubbles: true,
            })
          );
        }
      }));

    test('a cancellable delete is prevented and not submitted', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        const event = new InputEvent('beforeinput', {
          inputType: 'deleteContentBackward',
          bubbles: true,
          cancelable: true,
        });
        r.root.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }));

    test('a browser mutation behind an uncancellable beforeinput is repaired', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'x',
            bubbles: true,
            cancelable: false,
          })
        );
        // The browser's own edit, which no handler could prevent.
        r.leaf().nodeValue = 'boxdy';
        r.moveDomCaret(3);
        r.root.dispatchEvent(
          new InputEvent('input', {
            inputType: 'insertText',
            data: 'x',
            bubbles: true,
          })
        );
      }));

    test('a composition across the demotion is not submitted and is repaired', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionstart', { data: '', bubbles: true })
        );
        r.leaf().nodeValue = 'bokdy';
        r.moveDomCaret(3);
        r.root.dispatchEvent(
          new CompositionEvent('compositionend', { data: 'k', bubbles: true })
        );
      }));

    test('a composition started before demotion repairs its final browser text', async () => {
      const r = mount();
      try {
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionstart', { data: '', bubbles: true })
        );
        r.authorize(false, comment);
        const before = r.view.query.serializedState();
        r.leaf().nodeValue = 'bokdy';
        r.moveDomCaret(3);
        r.root.dispatchEvent(
          new CompositionEvent('compositionend', { data: 'k', bubbles: true })
        );
        expect(r.errors).toEqual([]);
        expect(r.view.query.serializedState()).toBe(before);
        expect(r.root.textContent).toBe('body');
        r.expectHealthyEdit();
      } finally {
        await r.close();
      }
    });

    test('a refused composition rebuilds a browser-replaced text leaf', () =>
      demoted((r) => {
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionstart', { data: '', bubbles: true })
        );
        const leaf = r.leaf();
        leaf.parentElement?.replaceChildren(
          document.createTextNode('outside'),
          document.createTextNode('replacement')
        );
        r.root.dispatchEvent(
          new CompositionEvent('compositionend', { data: 'k', bubbles: true })
        );
      }));

    test('a refused composition preserves a foreign DOM selection', async () => {
      const r = mount();
      const other = document.createElement('div');
      other.setAttribute('contenteditable', 'true');
      other.tabIndex = 0;
      other.textContent = 'other';
      document.body.append(other);
      try {
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionstart', { data: '', bubbles: true })
        );
        r.authorize(false, comment);
        const before = r.view.query.serializedState();
        const foreign = other.firstChild;
        if (!foreign) throw new Error('Missing foreign text');
        other.focus();
        document.getSelection()?.setBaseAndExtent(foreign, 2, foreign, 2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionend', { data: '', bubbles: true })
        );
        expect(r.errors).toEqual([]);
        expect(r.view.query.serializedState()).toBe(before);
        expect(document.getSelection()?.anchorNode).toBe(foreign);
        expect(document.getSelection()?.anchorOffset).toBe(2);
        expect(document.activeElement).toBe(other);
      } finally {
        await r.close();
        other.remove();
      }
    });

    test('a refused composition does not disturb an external input caret', async () => {
      const r = mount();
      const input = document.createElement('input');
      input.value = 'other';
      document.body.append(input);
      try {
        const key = r.view.keyFromDOM(r.leaf());
        if (key === null) throw new Error('Missing text key');
        r.port.selectionFromView({
          kind: 'range',
          anchor: { key, offset: 4, type: 'text' },
          focus: { key, offset: 4, type: 'text' },
        });
        r.moveDomCaret(2);
        r.root.dispatchEvent(
          new CompositionEvent('compositionstart', { data: '', bubbles: true })
        );
        r.authorize(false, comment);
        input.focus();
        input.setSelectionRange(1, 3);
        // Input selection and the document's retained range are independent.
        r.moveDomCaret(1);
        expect(document.activeElement).toBe(input);
        const selection = document.getSelection();
        const anchor = selection?.anchorNode;
        const offset = selection?.anchorOffset;
        r.root.dispatchEvent(
          new CompositionEvent('compositionend', { data: '', bubbles: true })
        );
        expect(r.errors).toEqual([]);
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(1);
        expect(input.selectionEnd).toBe(3);
        expect(document.getSelection()?.anchorNode).toBe(anchor);
        expect(document.getSelection()?.anchorOffset).toBe(offset);
      } finally {
        await r.close();
        input.remove();
      }
    });

    test('cut still exports the selection but does not remove it', () =>
      demoted((r) => {
        const node = r.leaf();
        document.getSelection()?.setBaseAndExtent(node, 0, node, 4);
        r.root.dispatchEvent(new Event('selectionchange', { bubbles: true }));
        // jsdom has no DataTransfer; the handler only calls setData.
        const data = new Map<string, string>();
        const event = new Event('cut', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: {
            setData: (type: string, value: string) => data.set(type, value),
          },
        });
        r.root.dispatchEvent(event);
      }));
  });

  test(`a ${label} revoke queued ahead of a key is honoured at admission`, async () => {
    const r = mount();
    try {
      r.moveDomCaret(2);
      const before = r.view.query.serializedState();
      // Inside one executor turn: the key's submission queues behind the
      // running revoke, so the session is no longer Edit when it is admitted.
      r.executor.run(() => {
        r.key('@');
        return r.executor.session.authorization(
          true,
          false,
          comment,
          r.executor.now(),
          Date.now()
        );
      });
      expect(r.executor.session.effectiveAccess()).toBe(access);
      expect(r.errors).toEqual([]);
      expect(r.view.query.serializedState()).toBe(before);
      r.expectHealthyEdit();
    } finally {
      await r.close();
    }
  });
}

describe('an editor is unaffected', () => {
  test('a caret move plus a key still reaches the session', async () => {
    const r = mount();
    try {
      r.moveDomCaret(2);
      r.key('ArrowRight');
      expect(r.errors).toEqual([]);
    } finally {
      await r.close();
    }
  });

  test('a plain insertText still edits the document', async () => {
    const r = mount();
    try {
      r.moveDomCaret(2);
      const event = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true,
      });
      r.root.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      r.leaf().nodeValue = 'boxdy';
      r.moveDomCaret(3);
      r.root.dispatchEvent(
        new InputEvent('input', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
        })
      );
      expect(r.errors).toEqual([]);
      expect(r.root.textContent).toBe('boxdy');
      expect(r.view.query.serializedState()).toContain('boxdy');
    } finally {
      await r.close();
    }
  });
});
