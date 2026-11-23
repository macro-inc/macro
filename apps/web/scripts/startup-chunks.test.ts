import type { Plugin, PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  createAppViteConfig,
  cutIntoParts,
  dependencyFirstPositions,
  STARTUP_PART_CODE_BYTES,
  startupChunkCycle,
} from '../vite.base';

const graph = (edges: Record<string, string[]>) => (id: string) =>
  edges[id] ?? [];

describe('dependencyFirstPositions', () => {
  it('puts a module after its imports and a cycle in one position', () => {
    const positions = dependencyFirstPositions(
      ['entry'],
      graph({ entry: ['a', 'lib'], a: ['b'], b: ['a', 'lib'] })
    );
    const at = (id: string) => positions.get(id) ?? -1;
    expect(at('a')).toBe(at('b'));
    expect(at('lib')).toBeLessThan(at('a'));
    expect(at('a')).toBeLessThan(at('entry'));
  });

  it('follows an import chain longer than the call stack', () => {
    const length = 200_000;
    const positions = dependencyFirstPositions(['m0'], (id) => {
      const n = Number(id.slice(1)) + 1;
      return n < length ? [`m${n}`] : [];
    });
    expect(positions.size).toBe(length);
    expect(positions.get('m0')).toBe(length - 1);
  });
});

describe('cutIntoParts', () => {
  // Two modules fill a part; one does not.
  const big = Math.ceil(STARTUP_PART_CODE_BYTES * 0.6);

  it('starts a new part once a part reaches the size', () => {
    const parts = cutIntoParts(
      ['a', 'b', 'c', 'd'],
      (id) => ['a', 'b', 'c', 'd'].indexOf(id),
      () => big
    );
    expect(parts).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('never cuts between modules that import each other', () => {
    const position: Record<string, number> = { a: 0, b: 1, c: 1, d: 2 };
    const parts = cutIntoParts(
      ['a', 'b', 'c', 'd'],
      (id) => position[id],
      () => big
    );
    expect(parts).toEqual([['a', 'b', 'c'], ['d']]);
  });
});

describe('startupChunkCycle', () => {
  const chunk = (fileName: string, imports: string[], isEntry = false) => ({
    fileName,
    imports,
    isEntry,
  });

  it('accepts chunks that only import earlier ones', () => {
    expect(
      startupChunkCycle([
        chunk('index.js', ['startup-1.js', 'vendor-1.js'], true),
        chunk('startup-1.js', ['vendor-1.js']),
        chunk('vendor-1.js', []),
      ])
    ).toBeUndefined();
  });

  it('names the chunks of a cycle the entries load', () => {
    expect(
      startupChunkCycle([
        chunk('index.js', ['startup-1.js'], true),
        chunk('startup-1.js', ['vendor-1.js']),
        chunk('vendor-1.js', ['startup-1.js']),
      ])
    ).toEqual(['startup-1.js', 'vendor-1.js', 'startup-1.js']);
  });

  it('checks every entry', () => {
    expect(
      startupChunkCycle([
        chunk('index.js', ['vendor-1.js'], true),
        chunk('canvas.js', ['startup-1.js'], true),
        chunk('startup-1.js', ['startup-2.js']),
        chunk('startup-2.js', ['startup-1.js']),
        chunk('vendor-1.js', []),
      ])
    ).toEqual(['startup-1.js', 'startup-2.js', 'startup-1.js']);
  });

  it('visits a chunk many others import once', () => {
    // Each level imports both chunks of the next: 2^60 paths, 120 chunks.
    const levels = 60;
    const chunks = [chunk('index.js', ['a0.js', 'b0.js'], true)];
    for (let level = 0; level < levels; level += 1) {
      const next =
        level + 1 < levels ? [`a${level + 1}.js`, `b${level + 1}.js`] : [];
      chunks.push(chunk(`a${level}.js`, next), chunk(`b${level}.js`, next));
    }
    expect(startupChunkCycle(chunks)).toBeUndefined();
  });

  it('ignores cycles among chunks no entry imports statically', () => {
    expect(
      startupChunkCycle([
        chunk('index.js', [], true),
        chunk('lazy-a.js', ['lazy-b.js']),
        chunk('lazy-b.js', ['lazy-a.js']),
      ])
    ).toBeUndefined();
  });
});

describe('createAppViteConfig', () => {
  it('checks the startup chunks in production builds', async () => {
    const config = await createAppViteConfig()({
      command: 'build',
      mode: 'production',
    });
    const flatten = async (option: PluginOption): Promise<Plugin[]> => {
      const resolved = await option;
      if (!resolved) return [];
      if (Array.isArray(resolved)) {
        return (await Promise.all(resolved.map(flatten))).flat();
      }
      return [resolved as Plugin];
    };
    const names = (await flatten(config.plugins)).map((plugin) => plugin.name);
    expect(names).toContain('acyclic-startup-chunks');
  });
});
