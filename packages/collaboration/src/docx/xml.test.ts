import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cloneElement,
  element,
  getAttribute,
  parseElement,
  parseXml,
  serializeXml,
  setAttribute,
  textContent,
  textNode,
} from './xml';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const blocks = (name: string): Array<[string, string]> =>
  JSON.parse(fixture(`${name}.blocks.json`));

describe('xml', () => {
  it('reproduces every engine-saved block and the styles part byte for byte', () => {
    for (const name of ['mutual-nda', 'complex-msa'])
      for (const [, xml] of blocks(name))
        expect(serializeXml(parseElement(xml))).toBe(xml);
    const styles = fixture('styles.xml');
    expect(serializeXml(parseXml(styles))).toBe(styles);
  });

  it('keeps comments, CDATA and processing instructions verbatim', () => {
    const xml =
      "<?pi x?><a x='1'><!-- note --><![CDATA[<raw>]]>t &amp; u<b/></a>";
    const nodes = parseXml(xml);
    expect(serializeXml(nodes)).toBe(xml);
    expect(textContent(nodes[1])).toBe('<raw>t & u');
  });

  it('re-renders only elements whose attributes change', () => {
    const root = parseElement(
      '<w:p a="1"><w:r  b = "2" ><w:t>x</w:t></w:r></w:p>'
    );
    setAttribute(root, 'a', 'one & "two"');
    expect(serializeXml(root)).toBe(
      '<w:p a="one &amp; &quot;two&quot;"><w:r  b = "2" ><w:t>x</w:t></w:r></w:p>'
    );
    expect(getAttribute(root, 'a')).toBe('one & "two"');
  });

  it('opens a self-closing element that gains children', () => {
    const root = parseElement('<w:r x="1" />');
    root.children.push(element('w:t', {}, [textNode('a < b')]));
    expect(serializeXml(root)).toBe('<w:r x="1"><w:t>a &lt; b</w:t></w:r>');
  });

  it('decodes character references', () => {
    expect(textContent(parseElement('<t>&#65;&#x42;&lt;&apos;</t>'))).toBe(
      "AB<'"
    );
  });

  it('clones without sharing nodes', () => {
    const root = parseElement('<a><b c="1"/></a>');
    const copy = cloneElement(root);
    setAttribute(copy.children[0] as never, 'c', '2');
    expect(serializeXml(root)).toBe('<a><b c="1"/></a>');
    expect(serializeXml(copy)).toBe('<a><b c="2" /></a>');
  });

  it('rejects mismatched tags', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('<a>')).toThrow();
  });
});
