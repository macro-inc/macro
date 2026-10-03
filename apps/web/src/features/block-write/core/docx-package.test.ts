// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bridge,
  fixture,
  loadEngine,
  SYNC_SESSION_SETTINGS,
  xmlText,
} from '../tests/docx-test-peer';
import {
  assembleDocumentXml,
  assemblePackage,
  BLOCKS_PLACEHOLDER,
  DOCUMENT_PART,
  decodePart,
  encodePart,
  splitDocumentXml,
  splitPackage,
} from './docx-package';

beforeAll(loadEngine, 60_000);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PT = 'http://powertools.codeplex.com/2011';

function documentXml(body: string) {
  return `<?xml version="1.0" encoding="utf-8"?><w:document xmlns:w="${W}" xmlns:r="urn:r"><w:body xmlns:p18="${PT}">${body}</w:body></w:document>`;
}

describe('splitDocumentXml', () => {
  it('extracts top-level blocks with their ids and keeps the final section in the shell', () => {
    const split = splitDocumentXml(
      documentXml(
        '<w:p p18:Unid="a1"><w:r><w:t>One &gt; two</w:t></w:r></w:p>' +
          '<!-- note --><w:tbl p18:Unid="b2"><w:tr><w:tc><w:p p18:Unid="c3"/></w:tc></w:tr></w:tbl>' +
          '<w:p p18:Unid="d4" w:rsidR="x>y"/>' +
          '<w:sectPr p18:Unid="e5"><w:pgSz w:w="12240"/></w:sectPr>'
      )
    );
    expect(split.order).toEqual(['a1', 'b2', 'd4']);
    expect(split.shell).toContain(`${BLOCKS_PLACEHOLDER}<w:sectPr`);
    expect(split.shell).not.toContain('a1');
    // Blocks declare the prefixes their ancestors declared.
    const first = split.blocks.get('a1')!;
    expect(first).toContain(`xmlns:p18="${PT}"`);
    expect(first).toContain(`xmlns:w="${W}"`);
    expect(first).not.toContain('xmlns:r=');
    expect(split.blocks.get('d4')).toContain('w:rsidR="x>y"');
  });

  it('round-trips through assembly', () => {
    const xml = documentXml(
      '<w:p p18:Unid="a1"><w:r><w:t>Hello</w:t></w:r></w:p><w:p p18:Unid="b2"/>'
    );
    const split = splitDocumentXml(xml);
    const assembled = assembleDocumentXml({
      order: split.order,
      blocks: split.blocks,
      parts: new Map([[DOCUMENT_PART, split.shell]]),
    });
    expect(splitDocumentXml(assembled).order).toEqual(['a1', 'b2']);
    expect(xmlText(assembled)).toBe('Hello');
  });

  it('gives elements without ids a deterministic content address', () => {
    const xml = documentXml('<w:p/><w:p/><w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const first = splitDocumentXml(xml);
    expect(new Set(first.order).size).toBe(3);
    expect(splitDocumentXml(xml).order).toEqual(first.order);
  });

  it('handles an empty body', () => {
    const split = splitDocumentXml(documentXml(''));
    expect(split.order).toEqual([]);
    expect(split.shell).toContain(BLOCKS_PLACEHOLDER);
  });

  it('rejects documents that are not WordprocessingML', () => {
    expect(() => splitDocumentXml('<root><body/></root>')).toThrow();
  });
});

describe('package parts', () => {
  it('encodes binary parts as base64 and text parts verbatim', () => {
    const binary = new Uint8Array([0, 255, 128, 10]);
    const encoded = encodePart('word/media/image1.png', binary);
    expect(encoded.startsWith('b64:')).toBe(true);
    expect(decodePart(encoded)).toEqual(binary);
    expect(
      encodePart('word/styles.xml', new TextEncoder().encode('<a/>'))
    ).toBe('<a/>');
  });
});

describe.each(['mutual-nda.docx', 'complex-msa.docx'])(
  'engine snapshots of %s',
  (name) => {
    it('split into blocks that reopen to the same document', () => {
      const engine = bridge();
      const handle = engine.OpenSession(fixture(name), SYNC_SESSION_SETTINGS);
      try {
        const state = splitPackage(engine.SaveWithAnchorIds(handle));
        expect(state.order.length).toBeGreaterThan(5);
        expect(state.parts.has('word/styles.xml')).toBe(true);
        const reopened = engine.OpenSession(
          assemblePackage(state),
          SYNC_SESSION_SETTINGS
        );
        try {
          const again = splitPackage(engine.SaveWithAnchorIds(reopened));
          expect(again.order).toEqual(state.order);
          for (const id of state.order)
            expect(xmlText(again.blocks.get(id)!)).toBe(
              xmlText(state.blocks.get(id)!)
            );
          // User-facing saves strip the engine's anchor ids.
          const clean = unzipSync(engine.Save(reopened));
          expect(strFromU8(clean[DOCUMENT_PART])).not.toContain('Unid=');
        } finally {
          engine.CloseSession(reopened);
        }
      } finally {
        engine.CloseSession(handle);
      }
    });

    it('produce blocks every raw engine operation accepts', () => {
      const engine = bridge();
      const handle = engine.OpenSession(fixture(name), SYNC_SESSION_SETTINGS);
      try {
        const state = splitPackage(engine.SaveWithAnchorIds(handle));
        const anchors = JSON.parse(engine.ListAnchors!(handle))
          .anchorIndex as Record<string, { unid: string; scope: string }>;
        const byId = new Map(
          Object.entries(anchors)
            .filter(([, info]) => info.scope === 'body')
            .map(([anchor, info]) => [info.unid, anchor])
        );
        const paragraph = state.order.find((id) =>
          byId.get(id)?.startsWith('p:')
        )!;
        const result = JSON.parse(
          engine.RawReplaceXml(
            handle,
            byId.get(paragraph)!,
            state.blocks.get(paragraph)!
          )
        );
        expect(result.success).toBe(true);
      } finally {
        engine.CloseSession(handle);
      }
    });
  }
);
