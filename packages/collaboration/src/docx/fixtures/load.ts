import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocxPackageState } from '../schema';

export type DocxFixture = 'mutual-nda' | 'complex-msa';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

/** Blocks the Docxodus engine saved for a test document, in order. */
export function fixtureBlocks(name: DocxFixture): Array<[string, string]> {
  return JSON.parse(read(`${name}.blocks.json`));
}

/** A collaborative state for a test document: its blocks and styles. */
export function fixtureState(name: DocxFixture): DocxPackageState {
  const blocks = fixtureBlocks(name);
  return {
    order: blocks.map(([id]) => id),
    blocks: new Map(blocks),
    parts: new Map([['word/styles.xml', read('styles.xml')]]),
  };
}

/** The block whose XML contains `text`. */
export function blockContaining(name: DocxFixture, text: string) {
  const found = fixtureBlocks(name).find(([, xml]) => xml.includes(text));
  if (!found) throw new Error(`no block contains ${text}`);
  return { id: found[0], xml: found[1] };
}
