import { writeFileSync } from 'node:fs';
import type { DateOption } from '@core/util/dateSearch/useDateSearch';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from '@lexical/table';
import {
  $createDateMentionNode,
  $createInlineSearchNode,
  DateMentionNode,
  InlineSearchNode,
} from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  type LexicalEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createItemHandler } from '../component/menu/MentionsMenu/utils/mentionHandlers';
import {
  INSERT_DATE_MENTION_COMMAND,
  mentionsPlugin,
} from '../plugins/mentions/mentionsPlugin';
import type { DateMentionItem } from '../utils/mentionsUtils';
import { behaviorEditor } from './editor';

vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      close() {}
      addEventListener() {}
      removeEventListener() {}
      send() {}
    }
  );
});

const captures: unknown[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (process.env.SOURCE_DATE_MENTION_OUTPUT)
    writeFileSync(
      process.env.SOURCE_DATE_MENTION_OUTPUT,
      JSON.stringify(captures, null, 2)
    );
});

function capture(editor: LexicalEditor) {
  return editor.read(() => {
    const selection = $getSelection();
    const point = $isRangeSelection(selection) ? selection.anchor : undefined;
    return {
      json: editor.getEditorState().toJSON(),
      text: $getRoot().getTextContent(),
      dates: $nodesOfType(DateMentionNode).map((node) => ({
        json: node.exportJSON(),
        own: Object.keys(node.exportJSON()),
        parent: node.getParentOrThrow().getType(),
      })),
      selection: $isRangeSelection(selection)
        ? {
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
            nodeType: point?.getNode().getType(),
            nodeText: point?.getNode().getTextContent(),
            format: selection.format,
            style: selection.style,
          }
        : null,
    };
  });
}

function fixture() {
  const actual = behaviorEditor(mentionsPlugin({}));
  actual.editor.update(
    () => {
      const text = $createTextNode('body');
      $getRoot().append($createParagraphNode().append(text));
      text.select(2, 2);
    },
    { discrete: true }
  );
  return actual;
}

test.each([
  { name: 'missing-uuid', payload: {}, expectedUuid: undefined },
  { name: 'null-uuid', payload: { mentionUuid: null }, expectedUuid: null },
  { name: 'empty-uuid', payload: { mentionUuid: '' }, expectedUuid: '' },
  {
    name: 'truthy-uuid',
    payload: { mentionUuid: 'issued-reference' },
    expectedUuid: 'issued-reference',
  },
])(
  'Source Date constructor retains $name',
  ({ name, payload, expectedUuid }) => {
    const { editor } = fixture();
    const handled: unknown = Reflect.apply(editor.dispatchCommand, editor, [
      INSERT_DATE_MENTION_COMMAND,
      {
        date: '2026-06-15T12:00:00.000Z',
        displayFormat: 'Today',
        ...payload,
      },
    ]);
    const result = capture(editor);
    expect(handled).toBe(true);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].json).toMatchObject({
      date: '2026-06-15T12:00:00.000Z',
      displayFormat: 'Today',
    });
    expect(result.dates[0].json.mentionUuid).toBe(expectedUuid);
    captures.push({ name, handled, result });
  }
);

test.each([
  ['empty', '', ''],
  ['verbatim', 'not-a-date', 'Unparsed label'],
])(
  'Source Date constructor copies %s strings without parsing',
  (name, date, displayFormat) => {
    const { editor } = fixture();
    const handled = editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
      date,
      displayFormat,
    });
    const result = capture(editor);
    expect(result.dates[0].json).toMatchObject({ date, displayFormat });
    captures.push({ name, handled, result });
  }
);

test.each([
  'plain',
  'bold',
  'expanded-forward',
  'expanded-backward',
  'code-format',
  'node',
  'committed-none',
  'root-element',
  'shadow-element',
])('Source Date insertion uses actual %s selection', (mode) => {
  const { editor } = fixture();
  editor.update(
    () => {
      const root = $getRoot();
      const text = root.getFirstDescendant();
      if (!$isTextNode(text)) throw new Error('Missing fixture text');
      if (mode === 'bold' || mode === 'code-format') {
        text.toggleFormat(mode === 'bold' ? 'bold' : 'code');
        text.select(2, 2);
      }
      if (mode === 'expanded-forward') text.select(1, 3);
      if (mode === 'expanded-backward') text.select(3, 1);
      if (mode === 'committed-none') $setSelection(null);
      if (mode === 'root-element') root.select(1, 1);
      if (mode === 'node') {
        const old = $createDateMentionNode({
          date: 'old-date',
          displayFormat: 'Previous',
        });
        text.getParentOrThrow().append(old);
        const selection = $createNodeSelection();
        selection.add(old.getKey());
        $setSelection(selection);
      }
      if (mode === 'shadow-element') {
        const cell = $createTableCellNode().append(
          $createParagraphNode().append($createTextNode('cell'))
        );
        root.append(
          $createTableNode().append($createTableRowNode().append(cell))
        );
        cell.select(1, 1);
      }
    },
    { discrete: true }
  );
  const handled = editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
    date: '2026-06-15T12:00:00.000Z',
    displayFormat: 'Today',
  });
  const result = capture(editor);
  expect(handled).toBe(true);
  expect(result.dates).toHaveLength(1);
  expect(result.dates[0].parent).toBe('paragraph');
  expect(result.dates[0].json.displayFormat).toBe('Today');
  expect(result.selection?.anchor).toEqual(result.selection?.focus);
  if (mode === 'expanded-forward' || mode === 'expanded-backward') {
    expect(result.text).toBe('bTodayy');
    expect(result.selection).toMatchObject({
      anchor: { type: 'text', offset: 0 },
      nodeText: 'y',
      format: 0,
    });
  } else if (mode === 'root-element') {
    expect(result.text).toBe('body\n\nToday');
    expect(result.selection).toMatchObject({
      anchor: { type: 'element', offset: 1 },
      nodeType: 'paragraph',
      nodeText: 'Today',
    });
  } else if (mode === 'shadow-element') {
    expect(result.text).toBe('body\n\ncellToday');
    expect(result.selection).toMatchObject({
      anchor: { type: 'element', offset: 2 },
      nodeType: 'paragraph',
      nodeText: 'cellToday',
    });
  } else if (mode === 'node' || mode === 'committed-none') {
    expect(result.text).toBe('bodyToday');
    expect(result.selection).toMatchObject({
      anchor: { type: 'element', offset: 2 },
      nodeType: 'paragraph',
    });
  } else {
    expect(result.text).toBe('boTodaydy');
    expect(result.selection).toMatchObject({
      anchor: { type: 'text', offset: 0 },
      nodeText: 'dy',
      format: 0,
    });
  }
  captures.push({ name: mode, handled, result });
});

test.each(['today', 'tomorrow', '2026-06-18'])(
  'actual Source date provider %s feeds the real menu handler',
  async (query) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    const { editor } = fixture();
    await createRoot(async (dispose) => {
      try {
        const options = useDateSearch({ query: () => query });
        const option = options()[0];
        expect(option).toBeDefined();
        const item: DateMentionItem = {
          kind: 'date',
          id: `date-${option.id}`,
          data: option,
        };
        await createItemHandler({ editor })(item);
        const result = capture(editor);
        expect(result.dates[0].json).toMatchObject({
          date: option.date.toISOString(),
          displayFormat: option.displayText,
        });
        captures.push({ name: `provider-${query}`, option, result });
      } finally {
        dispose();
      }
    });
  }
);

test('Source resolves Date dispatch before option getters and performs no tracking', async () => {
  const { editor } = fixture();
  const events: string[] = [];
  const dispatch = editor.dispatchCommand.bind(editor);
  Object.defineProperty(editor, 'dispatchCommand', {
    configurable: true,
    get() {
      events.push('dispatch-callee');
      return dispatch;
    },
  });
  const date = new Date('2026-06-15T12:00:00.000Z');
  Object.defineProperty(date, 'toISOString', {
    get() {
      events.push('iso-callee');
      return function (this: Date) {
        events.push('iso-call');
        return Reflect.apply(Date.prototype.toISOString, this, []);
      };
    },
  });
  const item: DateMentionItem = {
    kind: 'date',
    id: 'date-fixture',
    data: {
      id: 'fixture',
      type: 'preset',
      get date() {
        events.push('option-date');
        return date;
      },
      get displayText() {
        events.push('option-display');
        return 'Today';
      },
    },
  };
  await createItemHandler({
    get editor() {
      events.push('editor');
      return editor;
    },
    get blockId(): string | undefined {
      throw new Error('Date must not read tracking dependencies');
    },
  })(item);
  expect(events).toEqual([
    'editor',
    'dispatch-callee',
    'editor',
    'dispatch-callee',
    'option-date',
    'iso-callee',
    'iso-call',
    'option-display',
  ]);
  captures.push({ name: 'callee-order', events, result: capture(editor) });
});

test.each([undefined, null, { opaque: true }])(
  'Source retains opaque Date option failure %s after the REMOVE dispatch',
  async (failure) => {
    const { editor } = fixture();
    const events: string[] = [];
    const dispatch = editor.dispatchCommand.bind(editor);
    Object.defineProperty(editor, 'dispatchCommand', {
      configurable: true,
      get() {
        events.push('dispatch-callee');
        return dispatch;
      },
    });
    const option: DateOption = {
      id: 'failure',
      displayText: 'Today',
      type: 'preset',
      get date(): Date {
        events.push('option-date');
        throw failure;
      },
    };
    const observed: { caught: boolean; error?: unknown } = { caught: false };
    try {
      await createItemHandler({ editor })({
        kind: 'date',
        id: 'date-failure',
        data: option,
      });
    } catch (error) {
      observed.caught = true;
      observed.error = error;
    }
    expect(observed).toEqual({ caught: true, error: failure });
    expect(events).toEqual([
      'dispatch-callee',
      'dispatch-callee',
      'option-date',
    ]);
    expect(capture(editor).dates).toEqual([]);
    captures.push({ name: `opaque-${String(failure)}`, observed, events });
  }
);

test('Source invalid Date option rejects after actual search removal without inserting', async () => {
  const { editor } = behaviorEditor(mentionsPlugin({}));
  editor.update(
    () => {
      const search = $createInlineSearchNode('@today');
      $getRoot().append($createParagraphNode().append(search));
      search.selectEnd();
    },
    { discrete: true }
  );
  expect(editor.read(() => $nodesOfType(InlineSearchNode))).toHaveLength(1);
  const before = capture(editor);
  await expect(
    createItemHandler({ editor })({
      kind: 'date',
      id: 'invalid-date',
      data: {
        id: 'invalid',
        date: new Date(Number.NaN),
        displayText: 'Invalid',
        type: 'natural',
      },
    })
  ).rejects.toBeInstanceOf(RangeError);
  const after = capture(editor);
  expect(editor.read(() => $nodesOfType(InlineSearchNode))).toHaveLength(0);
  expect(after.dates).toHaveLength(0);
  expect(after.text).toBe('');
  captures.push({ name: 'invalid-date-after-remove', before, after });
});
