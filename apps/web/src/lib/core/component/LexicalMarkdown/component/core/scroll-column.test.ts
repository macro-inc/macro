import { describe, expect, it } from 'vitest';
import { scrollColumn } from './scroll-column';

function box(style: string) {
  const element = document.createElement('div');
  element.setAttribute('style', style);
  return element;
}

describe('scrollColumn', () => {
  it("skips a table's sideways box and the editor root, finding the column", () => {
    const column = box('overflow-y: auto');
    const root = box('overflow-x: auto');
    root.setAttribute('data-lexical-editor', 'true');
    const table = box('overflow-x: auto');
    const link = document.createElement('a');
    table.append(link);
    root.append(table);
    column.append(root);
    document.body.append(column);
    expect(scrollColumn(link)).toBe(column);
    column.remove();
  });

  it('finds nothing when no ancestor scrolls', () => {
    const root = box('');
    root.setAttribute('data-lexical-editor', 'true');
    const link = document.createElement('a');
    root.append(link);
    document.body.append(root);
    expect(scrollColumn(link)).toBeUndefined();
    root.remove();
  });
});
