import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  coverageRows,
  DOC_ENTRIES,
  filterEntries,
  groupEntries,
} from './registry';
import { extractDemoSource } from './source';

/** jsdom has no ResizeObserver; `Scroll` (and so `Panel.Body scroll`) needs one
 *  to construct. Demos only have to mount here, not resize. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(cleanup);

describe('doc registry', () => {
  it('discovers pages from the co-located .docs.tsx files', () => {
    expect(DOC_ENTRIES.length).toBeGreaterThan(0);
  });

  it('gives every page a unique slug', () => {
    const slugs = DOC_ENTRIES.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('groups only into known categories', () => {
    const grouped = groupEntries(DOC_ENTRIES).flatMap((group) => group.entries);
    expect(grouped.length).toBe(DOC_ENTRIES.length);
  });

  it('filters on name, category, and exports', () => {
    const byName = filterEntries(DOC_ENTRIES, 'button');
    expect(byName.some((entry) => entry.doc.name === 'Button')).toBe(true);
    expect(filterEntries(DOC_ENTRIES, '').length).toBe(DOC_ENTRIES.length);
    expect(filterEntries(DOC_ENTRIES, 'zzzznope')).toHaveLength(0);
  });

  it('reports coverage for every ui component file', () => {
    const rows = coverageRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.name === 'Button' && row.entry)).toBe(true);
  });
});

describe.each(DOC_ENTRIES.map((entry) => [entry.doc.name, entry] as const))(
  '%s docs',
  (_name, entry) => {
    it('has at least one demo with a unique id', () => {
      expect(entry.doc.demos.length).toBeGreaterThan(0);
      const ids = entry.doc.demos.map((demo) => demo.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    // The whole point of the region markers is that the code shown is the code
    // that ran. A typo'd or missing marker silently degrades a page to "no
    // source found", so it fails here instead.
    it('wraps every demo in a matching #region marker', async () => {
      const source = await entry.loadSource();
      for (const demo of entry.doc.demos) {
        expect(
          extractDemoSource(source, demo.id),
          `${entry.path} is missing "// #region demo:${demo.id}"`
        ).toBeTruthy();
      }
    });

    it.each(entry.doc.demos.map((demo) => [demo.id, demo] as const))(
      'renders the %s demo',
      (_id, demo) => {
        expect(() => render(() => demo.render())).not.toThrow();
      }
    );
  }
);
