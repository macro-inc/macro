import { describe, expect, it } from 'vitest';
import { scrollColumn } from './scroll-column';

function box(style: string, scrollHeight: number, clientHeight: number) {
  const element = document.createElement('div');
  element.setAttribute('style', style);
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { value: clientHeight });
  return element;
}

describe('scrollColumn', () => {
  it('skips a sideways-scrolling table box and finds the column that scrolls', () => {
    const column = box('overflow-y: auto', 2000, 600);
    const table = box('overflow-x: auto', 120, 120);
    const link = document.createElement('a');
    table.append(link);
    column.append(table);
    document.body.append(column);
    expect(scrollColumn(link)).toBe(column);
    column.remove();
  });

  it('finds nothing when no ancestor has more to scroll', () => {
    const column = box('overflow-y: auto', 300, 600);
    const link = document.createElement('a');
    column.append(link);
    document.body.append(column);
    expect(scrollColumn(link)).toBeUndefined();
    column.remove();
  });
});
