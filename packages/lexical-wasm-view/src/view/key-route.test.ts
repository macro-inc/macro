// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { registerNativeNormalizeEnter } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/native';
import { registerNativeTabIndentation } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/native';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('application Tab routes once through the real Macro session despite its critical table listener', () => {
  const fixture = nativeSurface();
  const { session, port, root, view: mounted, counters } = fixture;
  const releaseTab = registerNativeTabIndentation(mounted);
  const releaseEnter = registerNativeNormalizeEnter(mounted);
  try {
    expect(port.listeners().get('Key(Tab)')).toBe(
      (1 << 4) | (1 << 2) | (1 << 0)
    );
    port.setState(
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
                  children: [
                    {
                      type: 'tablecell',
                      version: 1,
                      headerState: 0,
                      colSpan: 1,
                      rowSpan: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...mounted.mirror.values()].find(
      (node) =>
        node.type === 'paragraph' &&
        mounted.node(node.parent ?? 0)?.type === 'tablecell'
    );
    if (!paragraph) throw new Error('Missing table paragraph');
    root.focus();
    const element = mounted.getElementByKey(paragraph.key);
    if (!element) throw new Error('Missing paragraph element');
    document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 0, type: 'element' },
      focus: { key: paragraph.key, offset: 0, type: 'element' },
    });
    const originalQuery = session.query.bind(session);
    let queries = 0;
    session.query = (input) => {
      queries++;
      return originalQuery(input);
    };
    session.nodeText = () => {
      throw new Error('Per-node crossing on routed key');
    };
    counters.admissions = 0;
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(counters.admissions).toBe(1);
    expect(root.querySelectorAll('tr')).toHaveLength(2);
    expect(queries).toBe(0);
    counters.admissions = 0;
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(counters.admissions).toBe(0);
  } finally {
    releaseTab();
    releaseEnter();
    fixture.close();
  }
});

test.each(['code-highlight', 'text'])(
  'native %s code arrows run once while middle-line browser movement stays unclaimed',
  (type) => {
    const fixture = nativeSurface();
    const { port, view, root, session, counters } = fixture;
    try {
      port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'custom-code',
                version: 1,
                language: 'rust',
                children: [
                  { type, version: 1, text: 'first' },
                  { type: 'linebreak', version: 1 },
                  { type, version: 1, text: 'middle' },
                  { type: 'linebreak', version: 1 },
                  { type, version: 1, text: 'last' },
                ],
              },
            ],
          },
        })
      );
      const first = [...view.mirror.values()].find(
        (node) => node.text === 'first'
      );
      const middle = [...view.mirror.values()].find(
        (node) => node.text === 'middle'
      );
      if (!first || !middle) throw new Error('Missing code highlights');
      const firstText = view.getElementByKey(first.key)?.firstChild;
      const middleText = view.getElementByKey(middle.key)?.firstChild;
      if (!firstText || !middleText) throw new Error('Missing highlight DOM');
      root.focus();
      document.getSelection()?.setBaseAndExtent(middleText, 2, middleText, 2);
      session.query = () => {
        throw new Error('Query crossing on arrow key');
      };
      session.nodeText = () => {
        throw new Error('Per-node crossing on arrow key');
      };
      counters.admissions = 0;
      const middleArrow = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(middleArrow);
      expect(middleArrow.defaultPrevented).toBe(false);
      expect(counters.admissions).toBe(1);
      document.getSelection()?.setBaseAndExtent(firstText, 0, firstText, 0);
      counters.admissions = 0;
      const up = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        keyCode: 38,
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(up);
      expect(up.defaultPrevented).toBe(true);
      expect(counters.admissions).toBe(1);
      expect(root.firstElementChild?.tagName).toBe('P');
      expect(root.children).toHaveLength(3);
      counters.admissions = 0;
      root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'x',
          keyCode: 88,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(counters.admissions).toBe(0);
    } finally {
      fixture.close();
    }
  }
);
