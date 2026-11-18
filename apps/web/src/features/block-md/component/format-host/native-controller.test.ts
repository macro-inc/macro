/** @vitest-environment jsdom */
import { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import { registerExternalEditorRoot } from '@macro-inc/lexical-wasm-view/view/editor-roots';
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
import { createNativeDocumentFormattingHost } from './native';
import { createNativeFormattingActions } from './native-actions';
import { createNativeDocumentLinkMenuHost } from './native-link-host';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { mount, select, state } from './native-test-fixture';

test('native formatting UI reads only the latest published fact snapshot', async () => {
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  let links: ReturnType<typeof createNativeDocumentLinkMenuHost> | undefined;
  const runtime = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
        links?.retire();
      },
      retired() {
        controller?.observer.retired();
        links?.retire();
      },
    },
  ]);
  let dispose = () => {};
  try {
    createRoot((stop) => {
      dispose = stop;
      links = createNativeDocumentLinkMenuHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
      });
      controller = createNativeDocumentFormattingHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
        links,
      });
    });
    runtime.port.setState(state('Published toolbar text'));
    select(runtime, 'Published toolbar text');
    expect(controller?.host.selection()?.bold).toBe(false);
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    expect(await actions.text('bold')).toEqual({
      status: 'success',
      handled: true,
    });
    expect(controller?.host.selection()?.bold).toBe(true);
    expect([...(controller?.host.selection()?.elementsInRange ?? [])]).toEqual([
      'paragraph',
    ]);
    expect(await actions.block('heading2')).toEqual({
      status: 'success',
      handled: true,
    });
    expect([...(controller?.host.selection()?.elementsInRange ?? [])]).toEqual([
      'heading2',
    ]);
    runtime.view.dispose();
    expect(controller?.host.interactable()).toBe(false);
    expect(controller?.host.selection()).toBeUndefined();
  } finally {
    controller?.dispose();
    links?.dispose();
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('terminal formatting retirement during its real Escape slot leaves native cleanup to the owner fence', async () => {
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  let links: ReturnType<typeof createNativeDocumentLinkMenuHost> | undefined;
  const runtime = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
        links?.retire();
      },
      retired() {
        controller?.observer.retired();
        links?.retire();
      },
    },
  ]);
  let dispose = () => {};
  let closing: Promise<void> | undefined;
  try {
    createRoot((stop) => {
      dispose = stop;
      links = createNativeDocumentLinkMenuHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
      });
      controller = createNativeDocumentFormattingHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
        links,
      });
    });
    runtime.port.setState(state('Terminal toolbar text'));
    controller?.menu.registerListeners({
      focusOut() {},
      transform: () => false,
      escape() {
        closing = runtime.close();
        expect(controller?.host.interactable()).toBe(false);
        return true;
      },
    });
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    if (!closing)
      throw new Error('Actual native Escape did not close its owner');
    await closing;
    expect(controller?.host.selection()).toBeUndefined();
    expect(() => runtime.executor.session.effectiveAccess()).toThrow();
  } finally {
    controller?.dispose();
    links?.dispose();
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

for (const end of ['component', 'view']) {
  test(`formatting owner bridge waits for publication and retires both ports on ${end} disposal`, async () => {
    let bridge:
      | ReturnType<typeof createNativeDocumentFormattingObserver>
      | undefined;
    const runtime = mount([
      {
        published(view) {
          bridge?.observer.published(view);
        },
        unavailable(reason) {
          bridge?.observer.unavailable(reason);
        },
        retired() {
          bridge?.observer.retired();
        },
      },
    ]);
    let dispose = () => {};
    try {
      createRoot((stop) => {
        dispose = stop;
        bridge = createNativeDocumentFormattingObserver({
          canEdit: () => true,
          alive: () => true,
        });
      });
      expect(bridge?.controller()).toBeUndefined();
      expect(bridge?.links()).toBeUndefined();
      runtime.port.setState(state('Real bridge publication'));
      select(runtime, 'Real bridge publication');
      expect(bridge?.controller()?.host.selection()?.bold).toBe(false);
      expect(bridge?.links()?.isEditable()).toBe(true);
      if (end === 'component') dispose();
      else runtime.view.dispose();
      expect(bridge?.controller()).toBeUndefined();
      expect(bridge?.links()).toBeUndefined();
    } finally {
      dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('failed initial formatting query releases partial UI listeners without publishing a host', async () => {
  let bridge:
    | ReturnType<typeof createNativeDocumentFormattingObserver>
    | undefined;
  const runtime = mount([
    {
      published(view) {
        bridge?.observer.published(view);
      },
      unavailable(reason) {
        bridge?.observer.unavailable(reason);
      },
      retired() {
        bridge?.observer.retired();
      },
    },
  ]);
  const remove = vi.spyOn(runtime.root, 'removeEventListener');
  const cause = { kind: 'injected query transport failure' };
  const query = vi.spyOn(runtime.port, 'query').mockImplementationOnce(() => {
    throw cause;
  });
  let dispose = () => {};
  try {
    createRoot((stop) => {
      dispose = stop;
      bridge = createNativeDocumentFormattingObserver({
        canEdit: () => true,
        alive: () => true,
      });
    });
    runtime.port.setState(state('Native publication remains valid'));
    expect(runtime.root.textContent).toBe('Native publication remains valid');
    expect(bridge?.controller()).toBeUndefined();
    expect(bridge?.links()).toBeUndefined();
    expect(
      remove.mock.calls.filter(([name]) => name === 'focusin')
    ).toHaveLength(1);
    expect(
      remove.mock.calls.filter(([name]) => name === 'focusout')
    ).toHaveLength(1);
  } finally {
    query.mockRestore();
    remove.mockRestore();
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('ordinary formatting component disposal inside another owner callback removes the real slot and keeps its view live', async () => {
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  let links: ReturnType<typeof createNativeDocumentLinkMenuHost> | undefined;
  const first = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
        links?.retire();
      },
      retired() {
        controller?.observer.retired();
        links?.retire();
      },
    },
  ]);
  const second = mount();
  let dispose = () => {};
  let callbacks = 0;
  try {
    createRoot((stop) => {
      dispose = stop;
      links = createNativeDocumentLinkMenuHost(first.view, {
        canEdit: () => true,
        alive: () => true,
      });
      controller = createNativeDocumentFormattingHost(first.view, {
        canEdit: () => true,
        alive: () => true,
        links,
      });
    });
    first.port.setState(state('Live component owner'));
    controller?.menu.registerListeners({
      focusOut() {},
      transform: () => false,
      escape() {
        callbacks++;
        return true;
      },
    });
    const command = createViewCommand(
      'Key(Escape)',
      (value): value is KeyboardEvent | null =>
        value === null || value instanceof KeyboardEvent
    );
    second.view.registerViewCommand(
      command,
      () => {
        controller?.dispose();
        links?.dispose();
        return true;
      },
      3
    );
    expect(second.port.nativeEscape?.dispatch()).toBe(true);
    expect(first.port.nativeEscape?.dispatch()).toBe(false);
    expect(callbacks).toBe(0);
    first.port.setState(state('Still live after UI disposal'));
    expect(first.root.textContent).toBe('Still live after UI disposal');
    expect(controller?.host.selection()).toBeUndefined();
  } finally {
    controller?.dispose();
    links?.dispose();
    dispose();
    await second.close();
    await first.close();
    second.root.remove();
    first.root.remove();
  }
});

test('the actual no-command binding cannot advertise native link menu capability', async () => {
  const runtime = mount(undefined, false);
  try {
    expect(() =>
      createNativeDocumentLinkMenuHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
      })
    ).toThrow('Native link menus require ordered Enter and Escape ports');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('real key registration failure preserves its opaque cause when cleanup also throws', async () => {
  const runtime = mount();
  const primary = undefined;
  const secondary = { kind: 'injected Escape unregister failure' };
  const register = vi
    .spyOn(runtime.executor.session, 'registerViewEnter')
    .mockImplementationOnce(() => {
      throw primary;
    });
  const unregister = vi
    .spyOn(runtime.executor.session, 'unregisterViewEscape')
    .mockImplementationOnce(() => {
      throw secondary;
    });
  const links = createNativeDocumentLinkMenuHost(runtime.view, {
    canEdit: () => true,
    alive: () => true,
  });
  try {
    let thrown: { error: unknown } | undefined;
    try {
      links.registerKeys({ escape: () => false, enter: () => false });
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: primary });
    expect(unregister).toHaveBeenCalledTimes(1);
  } finally {
    register.mockRestore();
    unregister.mockRestore();
    links.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('real key cleanup attempts both registrations after the first unregister fails', async () => {
  const runtime = mount();
  const cause = undefined;
  const links = createNativeDocumentLinkMenuHost(runtime.view, {
    canEdit: () => true,
    alive: () => true,
  });
  const cleanup = links.registerKeys({
    escape: () => false,
    enter: () => false,
  });
  const first = vi
    .spyOn(runtime.executor.session, 'unregisterViewEnter')
    .mockImplementationOnce(() => {
      throw cause;
    });
  const second = vi.spyOn(runtime.executor.session, 'unregisterViewEscape');
  try {
    let thrown: { error: unknown } | undefined;
    try {
      cleanup();
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: cause });
    expect(second).toHaveBeenCalledTimes(1);
  } finally {
    first.mockRestore();
    second.mockRestore();
    links.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test.each(['generating', 'waiting', 'error'])(
  'document %s lock hides formatting and refuses a previously queued action',
  async (lock) => {
    let stop = () => {};
    const documentState = createRoot((dispose) => {
      stop = dispose;
      return createMarkdownDocumentState();
    });
    const canInteract = () =>
      !documentState.generation.isGenerating() &&
      !documentState.generation.generatedAndWaiting() &&
      !documentState.editor.error();
    const runtime = mount();
    const links = createNativeDocumentLinkMenuHost(runtime.view, {
      canEdit: canInteract,
      alive: () => true,
    });
    const controller = createNativeDocumentFormattingHost(runtime.view, {
      canEdit: canInteract,
      alive: () => true,
      links,
    });
    try {
      runtime.port.setState(state('Locked text'));
      select(runtime, 'Locked text');
      expect(controller.host.interactable()).toBe(true);
      const actions = createNativeFormattingActions(
        runtime.view,
        canInteract,
        () => true
      );
      let pending: ReturnType<typeof actions.text> | undefined;
      let reported: { error: unknown } | undefined;
      try {
        runtime.executor.run(() => {
          pending = actions.text('bold');
          if (lock === 'generating')
            documentState.generation.setIsGenerating(true);
          if (lock === 'waiting')
            documentState.generation.setGeneratedAndWaiting(true);
          if (lock === 'error')
            documentState.editor.setError(
              MarkdownEditorErrors.JSON_PARSE_ERROR
            );
          expect(controller.host.interactable()).toBe(false);
          return runtime.executor.session.tick(
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        reported = { error };
      }
      const result = await pending;
      if (result?.status !== 'error')
        throw new Error('Expected queued formatting refusal');
      expect(result.error).toEqual(
        new Error('Native formatting requires an editable document')
      );
      expect(reported?.error).toBe(result.error);
      expect(runtime.root.querySelector('strong')).toBeNull();
      expect(runtime.root.textContent).toBe('Locked text');
    } finally {
      controller.dispose();
      links.dispose();
      stop();
      await runtime.close();
      runtime.root.remove();
    }
  }
);

test('body popup rectangle rejects another real editor range while its own model range remains', async () => {
  const first = mount();
  const second = mount();
  const links = createNativeDocumentLinkMenuHost(first.view, {
    canEdit: () => true,
    alive: () => true,
  });
  const controller = createNativeDocumentFormattingHost(first.view, {
    canEdit: () => true,
    alive: () => true,
    links,
  });
  const selection = document.getSelection();
  const choose = (root: HTMLElement, x: number) => {
    const node = document
      .createTreeWalker(root, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!(node instanceof Text) || !selection)
      throw new Error('Missing actual text range');
    const range = document.createRange();
    range.selectNodeContents(node);
    // jsdom has no layout. Keep the actual DOM Range and stub only its rectangle.
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new DOMRect(x, 20, 30, 15),
    });
    selection.removeAllRanges();
    selection.addRange(range);
  };
  try {
    first.port.setState(state('First owner'));
    second.port.setState(state('Second owner'));
    select(first, 'First owner');
    first.root.tabIndex = 0;
    second.root.tabIndex = 0;
    first.root.focus();
    choose(first.root, 10);
    expect(controller.bodyPopup.rectangle()?.x).toBe(10);
    second.root.focus();
    choose(second.root, 900);
    expect(document.activeElement).toBe(second.root);
    expect(first.view.selection().selection.kind).toBe('range');
    expect(controller.bodyPopup.rectangle()).toBeUndefined();
  } finally {
    selection?.removeAllRanges();
    controller.dispose();
    links.dispose();
    await first.close();
    await second.close();
    first.root.remove();
    second.root.remove();
  }
});

// Source popupPlugin $enhanceTableSelection: a TableSelection's popup text is
// TableSelection.getTextContent(), so MarkdownPopup offers Task over cells.
test('a native table selection publishes its cell text as the body popup selection text', async () => {
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  let links: ReturnType<typeof createNativeDocumentLinkMenuHost> | undefined;
  const runtime = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
        links?.retire();
      },
      retired() {
        controller?.observer.retired();
        links?.retire();
      },
    },
  ]);
  let dispose = () => {};
  try {
    createRoot((stop) => {
      dispose = stop;
      links = createNativeDocumentLinkMenuHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
      });
      controller = createNativeDocumentFormattingHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
        links,
      });
    });
    const cell = (text: string) => ({
      type: 'tablecell',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text }],
        },
      ],
    });
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [cell('A1'), cell('A2')],
                },
                {
                  type: 'tablerow',
                  version: 1,
                  children: [cell('B1'), cell('B2')],
                },
              ],
            },
          ],
        },
      })
    );
    const nodes = [...runtime.view.mirror.values()];
    const table = nodes.find((node) => node.type === 'table');
    const cells = nodes.filter((node) => node.type === 'tablecell');
    const first = cells[0];
    const last = cells.at(-1);
    if (!table || !first || !last) throw new Error('Missing native table');
    runtime.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: first.key,
      focusCell: last.key,
    });
    expect(controller?.bodyPopup.selectionText()).toBe('A1\tA2\nB1\tB2\n');
  } finally {
    controller?.dispose();
    links?.dispose();
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

// Source popupPlugin hides and re-requests the popup on every SELECTION_CHANGE,
// which Lexical dispatches only for a selection both of whose endpoints belong
// to the editor. While a native drag owns a TableSelection, each such
// selectionchange restarts the popup; a nested editor's caret does not, and
// nothing does after disposal.
test('an owned selectionchange during a native table drag restarts the body popup', async () => {
  let controller:
    | ReturnType<typeof createNativeDocumentFormattingHost>
    | undefined;
  let links: ReturnType<typeof createNativeDocumentLinkMenuHost> | undefined;
  const runtime = mount([
    {
      published(view) {
        controller?.observer.published(view);
      },
      unavailable(reason) {
        controller?.observer.unavailable(reason);
        links?.retire();
      },
      retired() {
        controller?.observer.retired();
        links?.retire();
      },
    },
  ]);
  let dispose = () => {};
  const releaseNested: Array<() => void> = [];
  try {
    createRoot((stop) => {
      dispose = stop;
      links = createNativeDocumentLinkMenuHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
      });
      controller = createNativeDocumentFormattingHost(runtime.view, {
        canEdit: () => true,
        alive: () => true,
        links,
      });
    });
    const cell = (text: string) => ({
      type: 'tablecell',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text }],
        },
      ],
    });
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [cell('A1'), cell('A2')],
                },
              ],
            },
          ],
        },
      })
    );
    const visible: boolean[] = [];
    controller?.menu.registerPopup({
      visible(value) {
        visible.push(value);
        return true;
      },
      selection() {},
    });
    runtime.root.dispatchEvent(new FocusEvent('focusin'));
    const cells = [...runtime.root.querySelectorAll('td')];
    const [first, second] = cells;
    if (!first || !second) throw new Error('Missing native cells');
    // jsdom has no PointerEvent; the observer reads only these fields.
    const pointer = (target: Element, type: string, buttons: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, buttons });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: 'mouse' },
      });
      target.dispatchEvent(event);
    };
    pointer(first, 'pointerdown', 1);
    pointer(second, 'pointermove', 1);
    expect(runtime.view.selection().selection.kind).toBe('table');
    const leaf = (cellElement: Element) => {
      const text = document
        .createTreeWalker(cellElement, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text) throw new Error('Missing cell text');
      return text;
    };
    const caretAt = (node: Node) => {
      document.getSelection()?.setBaseAndExtent(node, 0, node, 0);
      document.dispatchEvent(new Event('selectionchange'));
    };

    visible.length = 0;
    caretAt(leaf(second));
    expect(runtime.view.selection().selection.kind).toBe('table');
    expect(visible[0]).toBe(false);

    const nested = document.createElement('div');
    nested.contentEditable = 'true';
    nested.textContent = 'nested';
    first.append(nested);
    releaseNested.push(registerExternalEditorRoot(nested, {}));
    visible.length = 0;
    caretAt(leaf(nested));
    expect(visible).toEqual([]);

    controller?.dispose();
    visible.length = 0;
    caretAt(leaf(second));
    expect(visible).toEqual([]);
  } finally {
    for (const release of releaseNested) release();
    controller?.dispose();
    links?.dispose();
    dispose();
    await runtime.close();
    runtime.root.remove();
  }
});
