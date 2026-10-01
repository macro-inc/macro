import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutomergeDoc } from '@macro-inc/automerge';
import { Mirror } from '@macro-inc/automerge/mirror';
import { describe, expect, it } from 'vitest';
import { MARKDOWN_AUTOMERGE_SCHEMA } from '../markdown-automerge-schema';

describe('markdown-golden.bin', () => {
  it('ensures that the \"golden\" snapshot is properly blank as expected', async () => {
    const golden = readFileSync(
      join(import.meta.dirname, '../../../static_assets/markdown-golden.2.bin')
    );

    const doc = new AutomergeDoc();
    doc.import(golden);

    const mirror = new Mirror({ doc, schema: MARKDOWN_AUTOMERGE_SCHEMA });
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
