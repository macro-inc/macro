// @vitest-environment jsdom
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test, vi } from 'vitest';
import { readSelection } from './selection';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('typed file requests arrive before clipboard facts release and do not insert clipboard text', async () => {
  const fixture = nativeSurface();
  const order: string[] = [];
  const releaseFacts = fixture.view.clipboard.registerFacts(() => ({
    entries: [
      {
        mime: 'application/x-macro-paste-facts',
        value: JSON.stringify({
          request: 99,
          hasFileEntries: true,
          mobileImageRecovery: false,
        }),
      },
    ],
    release: () => {
      order.push('release');
    },
  }));
  const releaseEvent = fixture.view.onPluginEvent(
    'group-b.file-paste',
    (payload) => {
      expect(payload).toEqual({ request: 99 });
      order.push('event');
    }
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'keep',
                  format: 0,
                  mode: 'normal',
                  style: '',
                  detail: 0,
                },
              ],
            },
          ],
        },
      })
    );
    fixture.counters.admissions = 0;
    expect(
      await fixture.view.clipboard.paste(
        transfer('# file name', '', [new File(['data'], 'fixture.txt')])
      )
    ).toBe(true);
    expect(order).toEqual(['event', 'release']);
    expect(fixture.root.textContent).toBe('keep');
    expect(fixture.counters.admissions).toBe(1);
  } finally {
    releaseFacts();
    releaseEvent();
    fixture.close();
  }
});

test('clipboard facts release once when a lazy HTML paste is cancelled by view disposal', async () => {
  const fixture = nativeSurface();
  let released = 0;
  fixture.view.clipboard.registerFacts(() => ({
    entries: [],
    release: () => {
      released++;
    },
  }));
  try {
    const pending = fixture.view.clipboard.paste(
      transfer('rich', '<p>rich</p>')
    );
    fixture.view.dispose();
    expect(released).toBe(1);
    expect(await pending).toBe(false);
    expect(released).toBe(1);
  } finally {
    fixture.close();
  }
});

test.each([false, true])(
  'plain-only=%s changes only Markdown parsing through the real native session',
  async (plainOnly) => {
    const fixture = nativeSurface();
    let released = 0;
    const releaseFacts = fixture.view.clipboard.registerFacts(() => ({
      entries: [
        {
          mime: 'application/x-macro-paste-facts',
          value: JSON.stringify({
            request: 0,
            hasFileEntries: false,
            mobileImageRecovery: false,
          }),
        },
      ],
      release: () => {
        released++;
      },
    }));
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [{ type: 'paragraph', version: 1, children: [] }],
          },
        })
      );
      const paragraph = [...fixture.view.mirror.values()].find(
        (node) => node.type === 'paragraph'
      );
      if (!paragraph) throw new Error('Missing paragraph');
      const element = fixture.view.getElementByKey(paragraph.key);
      if (!element) throw new Error('Missing paragraph element');
      fixture.root.focus();
      document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: paragraph.key, offset: 0, type: 'element' },
        focus: { key: paragraph.key, offset: 0, type: 'element' },
      });
      fixture.counters.admissions = 0;
      const inputs = vi.spyOn(fixture.port, 'input');
      expect(
        await fixture.view.clipboard.paste(
          transfer('**bold**'),
          readSelection(fixture.view),
          { plainOnly }
        )
      ).toBe(true);
      expect(inputs.mock.calls[0]?.[0].discriminator).toBe(plainOnly ? 10 : 4);
      expect(fixture.root.textContent).toBe(plainOnly ? '**bold**' : 'bold');
      expect(fixture.root.querySelectorAll('strong')).toHaveLength(
        plainOnly ? 0 : 1
      );
      expect(fixture.counters.admissions).toBe(1);
      expect(released).toBe(1);
    } finally {
      releaseFacts();
      fixture.close();
    }
  }
);

test.each(['copy', 'cut'] as const)(
  '%s exports the current DOM range before selectionchange admission',
  (kind) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: 'fresh bold',
                    format: 1,
                    detail: 0,
                    mode: 'normal',
                    style: '',
                  },
                ],
              },
            ],
          },
        })
      );
      const node = [...fixture.view.mirror.values()].find(
        (node) => node.kind === 'text'
      );
      if (!node) throw new Error('Missing actual text node');
      const element = fixture.view.getElementByKey(node.key);
      if (!element) throw new Error('Missing actual text DOM');
      const leaf = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!leaf) throw new Error('Missing actual text leaf');
      fixture.root.focus();
      document.getSelection()?.setBaseAndExtent(leaf, 0, leaf, 10);
      // No synthetic selectionchange: the real copy handler must admit this range.
      const clipboard = transfer('');
      const event = new Event(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      fixture.root.dispatchEvent(event);
      expect(clipboard.getData('text/plain')).toBe('fresh bold');
      const payload = JSON.parse(
        clipboard.getData('application/x-lexical-editor')
      );
      expect(payload.nodes[0].text).toBe('fresh bold');
      expect(payload.nodes[0].format).toBe(1);
      expect(event.defaultPrevented).toBe(true);
      if (kind === 'cut') expect(fixture.root.textContent).toBe('');
    } finally {
      fixture.close();
    }
  }
);
test.each(['foreign', 'malformed', 'non-array'])(
  '%s source clipboard payload uses HTML with the original import formats',
  async (payloadKind) => {
    const { readFileSync } = await import('node:fs');
    const { URL: NodeURL } = await import('node:url');
    const { createHeadlessEditor } = await import('@lexical/headless');
    const { $generateNodesFromDOM } = await import('@lexical/html');
    const { $getRoot } = await import('lexical');
    const { SupportedNodeTypes, NodeReplacements } = await import(
      '@macro-inc/lexical-core/node-list'
    );
    const html = readFileSync(
      new NodeURL('./test/off-copy-bold.html', import.meta.url),
      'utf8'
    );
    const original = createHeadlessEditor({
      namespace: 'independent-off-import',
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
      onError(error) {
        throw error;
      },
    });
    original.update(
      () => {
        $getRoot().append(
          ...$generateNodesFromDOM(
            original,
            new DOMParser().parseFromString(html, 'text/html')
          )
        );
      },
      { discrete: true }
    );
    const expected = original.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .map((node) => ({
          text: node.getTextContent(),
          format: node.getFormat(),
        }))
    );
    expect(expected).toEqual([
      { text: 'Alpha ', format: 0 },
      { text: 'Bold', format: 1 },
      { text: ' plain', format: 0 },
      { text: 'Second', format: 0 },
    ]);
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [{ type: 'paragraph', version: 1, children: [] }],
          },
        })
      );
      const paragraph = [...fixture.view.mirror.values()].find(
        (node) => node.type === 'paragraph'
      );
      if (!paragraph) throw new Error('Missing actual paragraph');
      const dom = fixture.view.getElementByKey(paragraph.key);
      if (!dom) throw new Error('Missing actual paragraph DOM');
      fixture.root.focus();
      document.getSelection()?.setBaseAndExtent(dom, 0, dom, 0);
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: paragraph.key, type: 'element', offset: 0 },
        focus: { key: paragraph.key, type: 'element', offset: 0 },
      });
      const clipboard = transfer('Alpha Bold plain\n\nSecond', html);
      let serialized = '{invalid';
      if (payloadKind === 'foreign') {
        serialized = JSON.stringify({
          namespace: 'block-md-main_foreign',
          nodes: original.getEditorState().toJSON().root.children,
        });
      } else if (payloadKind === 'non-array') {
        serialized = JSON.stringify({
          namespace: fixture.view.options.namespace,
          nodes: null,
        });
      }
      clipboard.setData('application/x-lexical-editor', serialized);
      expect(await fixture.view.clipboard.paste(clipboard)).toBe(true);
      const actual = [...fixture.view.mirror.values()]
        .filter((node) => node.kind === 'text')
        .map((node) => ({ text: node.text, format: node.textProps?.format }));
      expect(actual).toEqual(expected);
    } finally {
      fixture.close();
    }
  }
);

test('matching instance clipboard JSON takes priority over conflicting HTML', async () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [] }],
        },
      })
    );
    const paragraph = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'paragraph'
    );
    if (!paragraph) throw new Error('Missing paragraph');
    const dom = fixture.view.getElementByKey(paragraph.key);
    if (!dom) throw new Error('Missing paragraph DOM');
    fixture.root.focus();
    document.getSelection()?.setBaseAndExtent(dom, 0, dom, 0);
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, type: 'element', offset: 0 },
      focus: { key: paragraph.key, type: 'element', offset: 0 },
    });
    const clipboard = transfer('plain fallback', '<p>HTML fallback</p>');
    clipboard.setData(
      'application/x-lexical-editor',
      JSON.stringify({
        namespace: fixture.view.options.namespace,
        nodes: [
          {
            type: 'text',
            version: 1,
            text: 'JSON chosen',
            format: 1,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      })
    );
    expect(await fixture.view.clipboard.paste(clipboard)).toBe(true);
    expect(fixture.root.textContent).toBe('JSON chosen');
    expect(fixture.root.querySelector('strong')?.textContent).toBe(
      'JSON chosen'
    );
  } finally {
    fixture.close();
  }
});

test('a caret returning to its pre-copy point is admitted after copy captures a newer range', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'copy range',
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing text');
    const element = fixture.view.getElementByKey(node.key);
    if (!element) throw new Error('Missing text DOM');
    const leaf = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!leaf) throw new Error('Missing text leaf');
    fixture.root.tabIndex = 0;
    fixture.root.focus();
    expect(document.activeElement).toBe(fixture.root);
    const selection = document.getSelection();
    if (!selection) throw new Error('Missing DOM selection');
    const caret = {
      kind: 'range' as const,
      anchor: { key: node.key, offset: 10, type: 'text' as const },
      focus: { key: node.key, offset: 10, type: 'text' as const },
    };
    selection.setBaseAndExtent(leaf, 10, leaf, 10);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual(caret);
    selection.setBaseAndExtent(leaf, 0, leaf, 10);
    const clipboard = transfer('');
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    fixture.root.dispatchEvent(event);
    expect(clipboard.getData('text/plain')).toBe('copy range');
    expect(fixture.view.selection().selection).toEqual({
      ...caret,
      dirty: false,
      anchor: { ...caret.anchor, offset: 0 },
    });
    selection.setBaseAndExtent(leaf, 10, leaf, 10);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual({
      ...caret,
      dirty: false,
    });
  } finally {
    fixture.close();
  }
});

test('a caret returning after an authoritative selection change is admitted', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'copy range',
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing text');
    const element = fixture.view.getElementByKey(node.key);
    if (!element) throw new Error('Missing text DOM');
    const leaf = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!leaf) throw new Error('Missing text leaf');
    fixture.root.tabIndex = 0;
    fixture.root.focus();
    expect(document.activeElement).toBe(fixture.root);
    const selection = document.getSelection();
    if (!selection) throw new Error('Missing DOM selection');
    const caret = {
      kind: 'range' as const,
      anchor: { key: node.key, offset: 10, type: 'text' as const },
      focus: { key: node.key, offset: 10, type: 'text' as const },
    };
    selection.setBaseAndExtent(leaf, 10, leaf, 10);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual(caret);
    expect(fixture.port.command(CommandCode.SelectAll)).toBe(true);
    selection.setBaseAndExtent(leaf, 0, leaf, 10);
    const clipboard = transfer('');
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    fixture.root.dispatchEvent(event);
    expect(clipboard.getData('text/plain')).toBe('copy range');
    expect(fixture.view.selection().selection).toEqual({
      ...caret,
      anchor: { ...caret.anchor, offset: 0 },
    });
    selection.setBaseAndExtent(leaf, 10, leaf, 10);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual({
      ...caret,
      dirty: false,
    });
    const admitted = fixture.counters.admissions;
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.counters.admissions).toBe(admitted);
  } finally {
    fixture.close();
  }
});

test.each([
  { key: 'Shift', release: false, plainOnly: true },
  { key: 'Shift', release: true, plainOnly: false },
  { key: 'Control', release: false, plainOnly: false },
  { key: 'Meta', release: false, plainOnly: false },
  { key: 'Alt', release: false, plainOnly: false },
])(
  'native paste captures window $key state with release=$release',
  async ({ key, release, plainOnly }) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [{ type: 'paragraph', version: 1, children: [] }],
          },
        })
      );
      const paragraph = [...fixture.view.mirror.values()].find(
        (node) => node.type === 'paragraph'
      );
      if (!paragraph) throw new Error('Missing paragraph');
      const element = fixture.view.getElementByKey(paragraph.key);
      if (!element) throw new Error('Missing paragraph element');
      fixture.root.focus();
      document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: paragraph.key, offset: 0, type: 'element' },
        focus: { key: paragraph.key, offset: 0, type: 'element' },
      });
      const inputs = vi.spyOn(fixture.port, 'input');
      const pastes = vi.spyOn(fixture.view.clipboard, 'paste');
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      if (release) window.dispatchEvent(new KeyboardEvent('keyup', { key }));
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: transfer('**literal**'),
      });
      fixture.root.dispatchEvent(event);
      const pending = pastes.mock.results[0];
      if (pending?.type !== 'return') throw new Error('Paste was not invoked');
      expect(await pending.value).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(inputs.mock.calls[0]?.[0].discriminator).toBe(plainOnly ? 10 : 4);
      expect(fixture.root.textContent).toBe(
        plainOnly ? '**literal**' : 'literal'
      );
      expect(fixture.root.querySelectorAll('strong')).toHaveLength(
        plainOnly ? 0 : 1
      );
    } finally {
      window.dispatchEvent(new KeyboardEvent('keyup', { key }));
      fixture.close();
    }
  }
);

test.each(['argument', 'window'])(
  'paste freezes %s intent before lazy HTML import without changing rich precedence',
  async (capture) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [{ type: 'paragraph', version: 1, children: [] }],
          },
        })
      );
      const paragraph = [...fixture.view.mirror.values()].find(
        (node) => node.type === 'paragraph'
      );
      if (!paragraph) throw new Error('Missing paragraph');
      const element = fixture.view.getElementByKey(paragraph.key);
      if (!element) throw new Error('Missing paragraph element');
      fixture.root.focus();
      document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: paragraph.key, offset: 0, type: 'element' },
        focus: { key: paragraph.key, offset: 0, type: 'element' },
      });
      const inputs = vi.spyOn(fixture.port, 'input');
      let pending: Promise<boolean>;
      if (capture === 'argument') {
        const intent = { plainOnly: true };
        pending = fixture.view.clipboard.paste(
          transfer('**literal**', '<p><strong>rich</strong></p>'),
          readSelection(fixture.view),
          intent
        );
        intent.plainOnly = false;
      } else {
        const pastes = vi.spyOn(fixture.view.clipboard, 'paste');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: transfer('**literal**', '<p><strong>rich</strong></p>'),
        });
        fixture.root.dispatchEvent(event);
        const result = pastes.mock.results[0];
        if (result?.type !== 'return') throw new Error('Paste was not invoked');
        pending = result.value;
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      }
      expect(await pending).toBe(true);
      const input = inputs.mock.calls[0]?.[0];
      if (!input?.isEditorPasteWithIntent())
        throw new Error('Missing typed paste input');
      expect(input.value.intent.plainOnly).toBe(true);
      expect(fixture.root.textContent).toBe('rich');
      expect(fixture.root.querySelectorAll('strong')).toHaveLength(1);
    } finally {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      fixture.close();
    }
  }
);

test('disposing the native view removes its window Shift listeners', () => {
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  let fixture: ReturnType<typeof nativeSurface> | undefined;
  try {
    fixture = nativeSurface();
    const keys = added.mock.calls.filter(
      ([name]) => name === 'keydown' || name === 'keyup'
    );
    expect(keys).toHaveLength(2);
    fixture.view.dispose();
    for (const [name, listener] of keys) {
      expect(removed).toHaveBeenCalledWith(name, listener);
    }
  } finally {
    fixture?.close();
    added.mockRestore();
    removed.mockRestore();
  }
});
