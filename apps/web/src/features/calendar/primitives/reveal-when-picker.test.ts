import { expect, it, vi } from 'vitest';
import { revealWhenPicker } from './reveal-when-picker';

it.each([
  [250, 600, 124],
  [120, 800, 20],
  [250, 400, 0],
])(
  'reveals only the space below the row (%s,%s)',
  (rowTop, bottom, expected) => {
    const scroll = document.createElement('div'),
      row = document.createElement('div'),
      picker = document.createElement('div');
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 100, 390, 400)
    );
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, rowTop, 390, 44)
    );
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, rowTop + 44, 390, bottom - rowTop - 44)
    );
    revealWhenPicker(scroll, row, picker);
    expect(scroll.scrollTop).toBe(expected);
  }
);
