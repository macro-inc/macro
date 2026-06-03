import { readFileSync } from 'node:fs';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { Mirror } from '../../loro-mirror/packages/core/src';
import { MARKDOWN_LORO_SCHEMA } from '../markdown-loro-schema';

describe('markdown-golden.bin', () => {
  it('ensures that the \"golden\" snapshot is properly blank as expected', async () => {
    const golden = readFileSync(
      new URL('../markdown-golden.1.bin', import.meta.url)
    );

    const doc = new LoroDoc();
    doc.import(golden);

    const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const state = mirror.getState() as any;

    expect(state.root).toBeDefined();
    expect(state.root.$.id).toEqual(expect.any(String));
    expect(state.root.children).toHaveLength(1);

    const [paragraph] = state.root.children;
    expect(paragraph.$.id).toEqual(expect.any(String));
    if (paragraph.children && paragraph.children.length === 1) {
      expect(paragraph.children).toHaveLength(1);
      expect(paragraph.children[0].text).toEqual('');
    }
  });
});
