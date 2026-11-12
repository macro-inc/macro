import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadingPaneListWidth } from './use-reading-pane-list-width';

const STORAGE_KEY = 'macro:pref:email:reading-pane-list-width';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** The width a freshly mounted Email view reads. */
function widthOnMount() {
  return createRoot((dispose) => {
    const [width] = useReadingPaneListWidth();
    const mounted = width();
    dispose();
    return mounted;
  });
}

it('starts at the default width', () => {
  expect(widthOnMount()).toBe(440);
});

it('reopens at the width the list was dragged to', () => {
  createRoot((dispose) => {
    const [width, setWidth] = useReadingPaneListWidth();
    setWidth(512);
    expect(width()).toBe(512);
    dispose();
  });

  expect(widthOnMount()).toBe(512);
});

it.each([
  ['9999', 720],
  ['12', 340],
  ['-600', 340],
])('fits a saved %s to the list bounds', (saved, width) => {
  localStorage.setItem(STORAGE_KEY, saved);
  expect(widthOnMount()).toBe(width);
});

it.each(['"wide"', 'null', '{"width":600}', 'not json'])(
  'reads a saved %s as never resized',
  (saved) => {
    localStorage.setItem(STORAGE_KEY, saved);
    expect(widthOnMount()).toBe(440);
  }
);
