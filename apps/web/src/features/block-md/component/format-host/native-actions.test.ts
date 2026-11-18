/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { sameSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import type {
  Point,
  ViewSelection,
} from '@macro-inc/lexical-wasm-view/view/types';
import { expect, test } from 'vitest';
import type { ILinkInfo } from '../../../../lib/core/component/LexicalMarkdown/plugins/links/linksPlugin';
import { createNativeFormattingActions } from './native-actions';
import { createNativeDocumentLinkMenuHost } from './native-link-host';
import { readNativeFormattingSelection } from './native-selection';
import { readNativeFormattingTableFacts } from './native-table-facts';
import { mount, select, state } from './native-test-fixture';

test.each(['factory', 'fixed'])(
  '%s formatting uses the acknowledged body range without admitting dialog DOM selection',
  async (lane) => {
    const runtime = mount();
    const dialog = document.createElement('div');
    dialog.textContent = 'Dialog text';
    document.body.append(dialog);
    try {
      runtime.port.setState(state('Body text'));
      const intended = select(runtime, 'Body text');
      const textDOM = document
        .createTreeWalker(runtime.root, NodeFilter.SHOW_TEXT)
        .nextNode();
      expect(textDOM?.textContent).toBe('Body text');
      const generation = runtime.view.mirror.keyGeneration;
      if (generation === null) throw new Error('Missing native generation');
      const range = document.createRange();
      range.selectNodeContents(dialog);
      const selection = document.getSelection();
      if (!selection) throw new Error('Missing actual DOM selection');
      selection.removeAllRanges();
      selection.addRange(range);
      expect(selection.toString()).toBe('Dialog text');
      const actions = createNativeFormattingActions(
        runtime.view,
        () => true,
        () => true
      );
      const result =
        lane === 'factory'
          ? await actions.block('heading2')
          : await runtime.port.inputSettled(
              EditorInputMsg.fromEditorApplication({
                name: 'group-b.node-transform',
                json: JSON.stringify('heading2'),
                generation,
                selection: selectionMessage(intended),
                keyboard: false,
                key: '',
                mods: 0,
                code: 0,
              })
            );
      expect(result).toEqual({
        status: 'success',
        handled: true,
      });
      const heading = runtime.root.querySelector('h2');
      if (!heading) throw new Error('Missing heading after native transform');
      expect(heading.textContent).toBe('Body text');
      expect(
        document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode()
      ).toBe(textDOM);
      expect(dialog.textContent).toBe('Dialog text');
      expect(sameSelection(runtime.view.selection().selection, intended)).toBe(
        true
      );
    } finally {
      dialog.remove();
      await runtime.close();
      runtime.root.remove();
    }
  }
);

test('queued formatting refuses a retired selection instead of targeting its new nodes', async () => {
  const runtime = mount();
  try {
    runtime.port.setState(state('Original text'));
    select(runtime, 'Original text');
    const generation = runtime.view.mirror.keyGeneration;
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    let pending: Promise<InputSettlement> | undefined;
    let reported: { error: unknown } | undefined;
    try {
      runtime.executor.run(() => {
        runtime.port.setState(state('Replacement text'));
        pending = actions.block('heading2');
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
      throw new Error('Expected actual refused formatting settlement');
    expect(result.error).toEqual(
      new Error('Native formatting target selection changed')
    );
    expect(reported?.error).toBe(result.error);
    expect(runtime.view.mirror.keyGeneration).toBe(generation);
    expect(runtime.root.querySelector('h2')).toBeNull();
    expect(runtime.root.textContent).toBe('Replacement text');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('list conversion uses the native-qualified top-level list at the acknowledged anchor', async () => {
  const runtime = mount();
  try {
    const listItem = (text: string) => ({
      type: 'listitem',
      version: 1,
      value: 1,
      children: [{ type: 'text', version: 1, text }],
    });
    const list = (children: object[]) => ({
      type: 'list',
      version: 1,
      listType: 'bullet',
      tag: 'ul',
      start: 1,
      children,
    });
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'Outside' }],
            },
            list([
              listItem('Header A'),
              { ...listItem(''), children: [list([listItem('Cell A')])] },
              listItem('Header B'),
              { ...listItem(''), children: [list([listItem('Cell B')])] },
            ]),
          ],
        },
      })
    );
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    select(runtime, 'Outside');
    expect(actions.canConvertList()).toBe(false);
    select(runtime, 'Header A');
    expect(actions.canConvertList()).toBe(true);
    expect(await actions.convertList()).toEqual({
      status: 'success',
      handled: true,
    });
    expect(
      Array.from(runtime.root.querySelectorAll('tr'), (row) =>
        Array.from(row.cells, (cell) => cell.textContent)
      )
    ).toEqual([
      ['Header A', 'Header B'],
      ['Cell A', 'Cell B'],
    ]);
    expect(runtime.root.querySelector(':scope > p')?.textContent).toBe(
      'Outside'
    );
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('desktop table formatting uses native cell facts and preserves the split range', async () => {
  const runtime = mount();
  try {
    const tableState = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../lib/core/component/LexicalMarkdown/editing/browser-test/fixtures/table-selection.json'
      ),
      'utf8'
    );
    runtime.port.setState(tableState);
    const records = [...runtime.view.mirror.values()];
    const table = records.find((record) => record.type === 'table');
    const [first, second] = records.filter(
      (record) => record.type === 'tablecell'
    );
    if (!table || !first || !second)
      throw new Error('Missing real table and cells');
    const generation = runtime.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing real generation');
    const facts = () => readNativeFormattingTableFacts(runtime.view, table.key);
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    runtime.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: first.key,
      focusCell: second.key,
    });
    expect(facts().selectedCellKeys).toEqual([first.key, second.key]);
    expect(await actions.mergeTableSelection()).toEqual({
      status: 'success',
      handled: true,
    });
    expect(runtime.root.querySelector('td')?.colSpan).toBe(2);
    expect(facts().selectedCellKeys).toBeNull();
    expect(facts().cells.get(first.key)?.colSpan).toBe(2);
    const merged = runtime.view.mirror.node(first.key);
    if (!merged) throw new Error('Missing retained merged cell');
    const paragraphKey = merged.children[0];
    const paragraph =
      paragraphKey === undefined
        ? null
        : runtime.view.mirror.node(paragraphKey);
    const textKey = paragraph?.children[0];
    if (textKey === undefined) throw new Error('Missing retained cell text');
    const range: ViewSelection = {
      kind: 'range',
      anchor: { key: textKey, offset: 0, type: 'text' },
      focus: { key: textKey, offset: 2, type: 'text' },
    };
    runtime.port.selectionFromView(range);
    expect(await actions.splitTableSelection()).toEqual({
      status: 'success',
      handled: true,
    });
    expect(runtime.root.querySelector('td')?.colSpan).toBe(1);
    expect(sameSelection(runtime.view.selection().selection, range)).toBe(true);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test.each(['Enter', 'Escape'])(
  'captured link target submits in the actual same-owner %s scope',
  async (key) => {
    const runtime = mount();
    let release: (() => void) | undefined;
    try {
      runtime.port.setState(state('Body text'));
      select(runtime, 'Body text');
      const actions = createNativeFormattingActions(
        runtime.view,
        () => true,
        () => true
      );
      const target = actions.captureLinkTarget();
      const command =
        key === 'Enter' ? runtime.port.nativeEnter : runtime.port.nativeEscape;
      if (!command) throw new Error('Missing actual native key capability');
      let completion: Promise<InputSettlement> | undefined;
      release = command.register(
        () => {
          if (!command.scope())
            throw new Error('Missing issued native callback scope');
          completion = target.insert('https://example.com/body', 'Body text');
          return true;
        },
        key === 'Enter' ? 4 : 3
      );
      expect(command.dispatch()).toBe(true);
      expect(await completion).toEqual({ status: 'success', handled: true });
      const link = runtime.root.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://example.com/body');
      expect(link?.textContent).toBe('Body text');
    } finally {
      release?.();
      await runtime.close();
      runtime.root.remove();
    }
  }
);

for (const backward of [false, true]) {
  test(`Prepare captures the new ${backward ? 'backward' : 'forward'} partial link target before opening and unlinking`, async () => {
    const runtime = mount();
    try {
      runtime.port.setState(state('left chosen right'));
      const text = [...runtime.view.mirror.values()].find(
        (node) => node.kind === 'text'
      );
      if (!text) throw new Error('Missing actual text');
      runtime.port.selectionFromView({
        kind: 'range',
        anchor: { key: text.key, offset: backward ? 11 : 5, type: 'text' },
        focus: { key: text.key, offset: backward ? 5 : 11, type: 'text' },
      });
      const actions = createNativeFormattingActions(
        runtime.view,
        () => true,
        () => true
      );
      let captured: ReturnType<typeof actions.captureLinkTarget> | undefined;
      let selection: ViewSelection | undefined;
      const result = await actions.prepareLink((handled) => {
        expect(handled).toBe(true);
        captured = actions.captureLinkTarget();
        selection = runtime.view.selection().selection;
      });
      expect(result).toEqual({ status: 'success', handled: true });
      const link = [...runtime.view.mirror.values()].find(
        (node) => node.type === 'link'
      );
      if (!link || !selection || selection.kind !== 'range' || !captured)
        throw new Error('Missing acknowledged prepared link target');
      expect(link.props().url).toBe('');
      expect(runtime.root.querySelector('a')?.getAttribute('href')).toBe(
        'https://'
      );
      expect(runtime.root.querySelector('a')?.textContent).toBe('chosen');
      expect(selection.anchor.offset).toBe(backward ? 6 : 0);
      expect(selection.focus.offset).toBe(backward ? 0 : 6);
      expect(selection.anchor.key).not.toBe(text.key);
      // Source cancel retains this empty link. No model action is sent on cancel.
      expect(link.props().url).toBe('');
      expect(await captured.unlink()).toEqual({
        status: 'success',
        handled: true,
      });
      expect(runtime.root.querySelector('a')).toBeNull();
      expect(runtime.root.textContent).toBe('left chosen right');
      const unlinked = runtime.view.selection().selection;
      if (unlinked.kind !== 'range') throw new Error('Missing unlinked range');
      expect(unlinked.anchor.offset).toBe(selection.anchor.offset);
      expect(unlinked.focus.offset).toBe(selection.focus.offset);
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('named text and element formatting use the sealed native core policies', async () => {
  const runtime = mount();
  try {
    runtime.port.setState(state('Body text'));
    const selection = select(runtime, 'Body text');
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    expect(await actions.text('bold')).toEqual({
      status: 'success',
      handled: true,
    });
    expect(runtime.root.querySelector('strong,b')?.textContent).toBe(
      'Body text'
    );
    expect(runtime.view.selection().format).toBe(1);
    expect(await actions.align('center')).toEqual({
      status: 'success',
      handled: true,
    });
    expect(runtime.root.querySelector('p')?.style.textAlign).toBe('center');
    expect(sameSelection(runtime.view.selection().selection, selection)).toBe(
      true
    );
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('the document link host opens edit after native Prepare and owns real keyboard cleanup', async () => {
  const runtime = mount();
  const host = createNativeDocumentLinkMenuHost(runtime.view, {
    canEdit: () => true,
    alive: () => true,
  });
  const edits: ILinkInfo[] = [];
  try {
    runtime.port.setState(state('Body text'));
    select(runtime, 'Body text');
    host.registerMenu({
      hover() {},
      create() {},
      click(info) {
        if (info) edits.push(info);
      },
    });
    const release = host.registerKeys({
      escape: () => false,
      enter: () => false,
    });
    host.requestLink();
    await expect.poll(() => edits.length).toBe(1);
    const info = edits[0];
    expect(info?.url).toBe('');
    expect(info?.linkText).toBe('Body text');
    expect(info?.autoFocus).toBe(true);
    expect(info?.linkRef && runtime.root.contains(info.linkRef)).toBe(true);
    host.unlink();
    await expect.poll(() => runtime.root.querySelector('a')).toBeNull();
    expect(runtime.root.textContent).toBe('Body text');
    release();
    host.dispose();
    host.dispose();
  } finally {
    host.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('the document link host suppresses the delayed dialog when the acknowledged target has changed', async () => {
  const runtime = mount();
  const host = createNativeDocumentLinkMenuHost(runtime.view, {
    canEdit: () => true,
    alive: () => true,
  });
  const edits: ILinkInfo[] = [];
  try {
    runtime.port.setState(state('Body text'));
    select(runtime, 'Body text');
    host.registerMenu({
      hover() {},
      create() {},
      click(info) {
        if (info) edits.push(info);
      },
    });
    host.requestLink();
    runtime.port.setState(state('Replacement'));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(edits).toEqual([]);
    expect(runtime.root.textContent).toBe('Replacement');
  } finally {
    host.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('formatting facts read actual native format flags and prepared link state', async () => {
  const runtime = mount();
  try {
    runtime.port.setState(state('Body text'));
    expect(readNativeFormattingSelection(runtime.view)).toBeUndefined();
    select(runtime, 'Body text');
    const before = readNativeFormattingSelection(runtime.view);
    expect(before?.elementsInRange).toEqual(new Set(['paragraph']));
    expect(before?.bold).toBe(false);
    expect(before?.italic).toBe(false);
    expect(before?.hasLinks).toBe(false);
    const actions = createNativeFormattingActions(
      runtime.view,
      () => true,
      () => true
    );
    expect(await actions.text('bold')).toEqual({
      status: 'success',
      handled: true,
    });
    expect(await actions.text('italic')).toEqual({
      status: 'success',
      handled: true,
    });
    const formatted = readNativeFormattingSelection(runtime.view);
    expect(formatted?.bold).toBe(true);
    expect(formatted?.italic).toBe(true);
    expect(formatted?.code).toBe(false);
    expect(formatted?.elementsInRange).toEqual(new Set(['paragraph']));
    expect(await actions.prepareLink(() => {})).toEqual({
      status: 'success',
      handled: true,
    });
    expect(readNativeFormattingSelection(runtime.view)?.hasLinks).toBe(true);
    expect(await actions.unlink()).toEqual({
      status: 'success',
      handled: true,
    });
    expect(readNativeFormattingSelection(runtime.view)?.hasLinks).toBe(false);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test.each([false, true])(
  'formatting facts preserve mixed top-level order for a backward=%s range',
  async (backward) => {
    const runtime = mount();
    try {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'Plain' }],
              },
              {
                type: 'heading',
                tag: 'h4',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'Four' }],
              },
              {
                type: 'heading',
                tag: 'h6',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'Six' }],
              },
            ],
          },
        })
      );
      const first = [...runtime.view.mirror.values()].find(
        (node) => node.kind === 'text' && node.text === 'Plain'
      );
      const last = [...runtime.view.mirror.values()].find(
        (node) => node.kind === 'text' && node.text === 'Six'
      );
      if (!first || !last)
        throw new Error('Missing actual native range endpoints');
      const start: Point = { key: first.key, offset: 0, type: 'text' };
      const end: Point = { key: last.key, offset: 3, type: 'text' };
      const selection: ViewSelection = {
        kind: 'range',
        anchor: backward ? end : start,
        focus: backward ? start : end,
      };
      runtime.port.selectionFromView(selection);
      const facts = readNativeFormattingSelection(runtime.view);
      expect(facts?.elementsInRange).toEqual(
        new Set(['paragraph', 'heading4', 'heading6'])
      );
      expect(facts?.hasLinks).toBe(false);
      expect(sameSelection(runtime.view.selection().selection, selection)).toBe(
        true
      );
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  }
);
