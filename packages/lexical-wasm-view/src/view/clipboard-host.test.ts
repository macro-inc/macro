// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
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
          plainOnly: false,
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
            plainOnly,
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
      expect(await fixture.view.clipboard.paste(transfer('**bold**'))).toBe(
        true
      );
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
