/** @vitest-environment jsdom */
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createProgressStatsStore } from '../progress';
import { createWordcountStatsStore } from '../wordcount';
import { createNativeEditorStats } from './native';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.useRealTimers());

const text = (value: string) => ({
  type: 'text',
  version: 1,
  text: value,
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
});
const block = { direction: null, format: '', indent: 0, version: 1 };
const item = (checked: boolean, value: string) => ({
  ...block,
  type: 'listitem',
  checked,
  value: 1,
  children: [text(value)],
});
const STATE = JSON.stringify({
  root: {
    ...block,
    type: 'root',
    children: [
      {
        ...block,
        type: 'paragraph',
        textFormat: 0,
        textStyle: '',
        children: [text('Hello brave world')],
      },
      {
        ...block,
        type: 'list',
        listType: 'check',
        start: 1,
        tag: 'ul',
        children: [item(true, 'done'), item(false, 'todo'), item(false, ' ')],
      },
    ],
  },
});

test('native stats fill the Source word count and checklist progress stores', async () => {
  vi.useFakeTimers();
  const fixture = nativeSurface();
  try {
    fixture.port.setState(STATE);
    const [wordcount, setWordcount] = createWordcountStatsStore();
    const [progress, setProgress] = createProgressStatsStore();
    const stats = createNativeEditorStats({
      setWordcount,
      setProgress,
      debounceTime: 200,
    });
    stats.published(fixture.view);
    await Promise.resolve();
    // Leaf checklist items with text; the blank item is skipped, as Source.
    expect({ ...progress }).toEqual({ completed: 1, total: 2 });
    expect(wordcount.totalWords).toBe(0);
    vi.advanceTimersByTime(200);
    expect({ ...wordcount }).toEqual({
      totalWords: 5,
      // Root children joined by \n; a list joins its items with \n\n, as Lexical.
      totalCharacters: 'Hello brave world\ndone\n\ntodo\n\n '.length,
      selectedWords: null,
      selectedCharacters: null,
    });

    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'text' && node.text === 'Hello brave world'
    );
    if (!leaf) throw new Error('Missing paragraph text');
    fixture.port.selectionFromView(
      {
        kind: 'range',
        anchor: { key: leaf.key, offset: 6, type: 'text' },
        focus: { key: leaf.key, offset: 17, type: 'text' },
      },
      {}
    );
    stats.published(fixture.view);
    vi.advanceTimersByTime(200);
    expect(wordcount.selectedWords).toBe(2);
    expect(wordcount.selectedCharacters).toBe('brave world'.length);
  } finally {
    fixture.close();
  }
});
