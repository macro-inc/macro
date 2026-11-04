import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createDiffCollapse } from './collapse';

const FILES = [
  { path: 'empty.ts', additions: 0, deletions: 0 },
  { path: 'boundary.ts', additions: 20, deletions: 20 },
  { path: 'large.ts', additions: 20, deletions: 21 },
];

describe('createDiffCollapse', () => {
  it('applies size defaults to arriving files and preserves explicit toggles', () => {
    createRoot((dispose) => {
      const [files, setFiles] = createSignal<typeof FILES>([]);
      const collapse = createDiffCollapse(files);
      setFiles(FILES);
      expect(collapse.isCollapsed('empty.ts')).toBe(false);
      expect(collapse.isCollapsed('boundary.ts')).toBe(false);
      expect(collapse.isCollapsed('large.ts')).toBe(true);
      collapse.toggle('boundary.ts');
      collapse.toggle('large.ts');
      setFiles(FILES.map((file) => ({ ...file, additions: 100 })));
      expect(collapse.isCollapsed('empty.ts')).toBe(true);
      expect(collapse.isCollapsed('boundary.ts')).toBe(true);
      expect(collapse.isCollapsed('large.ts')).toBe(false);
      dispose();
    });
  });

  it('collapses and expands every file regardless of its default', () => {
    createRoot((dispose) => {
      const collapse = createDiffCollapse(() => FILES);
      expect(collapse.anyExpanded()).toBe(true);
      collapse.toggleAll();
      expect(collapse.anyExpanded()).toBe(false);
      collapse.toggleAll();
      expect(collapse.isCollapsed('large.ts')).toBe(false);
      expect(collapse.isCollapsed('boundary.ts')).toBe(false);
      dispose();
    });
  });
});
