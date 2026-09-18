import { strFromU8 } from 'fflate';
import { SaxesParser } from 'saxes';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NORMALIZED = [
  MAIN,
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://schemas.openxmlformats.org/package/2006/content-types',
];
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r', '&#13;');
}

/** ExcelJS matches literal tag names, although valid OOXML may use any prefix.
 * Normalize names through namespace-aware XML parsing, never regex text edits. */
export function normalizeSpreadsheetXml(text: string, path: string): string {
  const prefixes: Record<string, string> = {
    'http://schemas.openxmlformats.org/package/2006/metadata/core-properties':
      'cp',
    'http://purl.org/dc/elements/1.1/': 'dc',
    'http://purl.org/dc/terms/': 'dcterms',
    'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes':
      'vt',
  };
  const tagName = (uri: string, local: string, name: string) =>
    NORMALIZED.includes(uri)
      ? local
      : prefixes[uri]
        ? `${prefixes[uri]}:${local}`
        : name;
  if (
    ![...NORMALIZED, ...Object.keys(prefixes)].some((namespace) =>
      text.includes(namespace)
    )
  )
    return text;
  const parser = new SaxesParser({ xmlns: true });
  const output: string[] = [];
  const defaultNamespaces: string[] = [];
  parser.on('doctype', () => {
    throw new Error('Unsupported Excel XML document type.');
  });
  parser.on('opentag', (node) => {
    const name = tagName(node.uri, node.local, node.name);
    const normalized = NORMALIZED.includes(node.uri);
    const inherited = defaultNamespaces.at(-1) ?? '';
    const defaultNamespace = normalized
      ? node.uri
      : (node.attributes.xmlns?.value ?? inherited);
    defaultNamespaces.push(defaultNamespace);
    const attributes = Object.values(node.attributes)
      .filter((attribute) => !(normalized && attribute.name === 'xmlns'))
      .map((attribute) => {
        const key =
          attribute.uri === REL ? `r:${attribute.local}` : attribute.name;
        let value = attribute.value;
        if (
          node.local === 'Relationship' &&
          key === 'Target' &&
          value.startsWith('/') &&
          node.attributes.TargetMode?.value !== 'External'
        ) {
          const base = path
            .replace(/(?:^|\/)_rels\/[^/]+$/, '')
            .split('/')
            .filter(Boolean);
          const target = value.split('/').filter(Boolean);
          while (base.length && target.length && base[0] === target[0]) {
            base.shift();
            target.shift();
          }
          value = [...base.map(() => '..'), ...target].join('/');
        }
        return `${key}="${escapeXml(value).replaceAll('\n', '&#10;').replaceAll('\t', '&#9;')}"`;
      });
    if (prefixes[node.uri] && !node.attributes[`xmlns:${prefixes[node.uri]}`])
      attributes.push(`xmlns:${prefixes[node.uri]}="${node.uri}"`);
    if (normalized && defaultNamespace !== inherited)
      attributes.push(`xmlns="${node.uri}"`);
    if (
      Object.values(node.attributes).some(
        (attribute) => attribute.uri === REL
      ) &&
      !node.attributes['xmlns:r']
    )
      attributes.push(`xmlns:r="${REL}"`);
    output.push(
      `<${name}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`
    );
  });
  parser.on('closetag', (node) => {
    defaultNamespaces.pop();
    output.push(`</${tagName(node.uri, node.local, node.name)}>`);
  });
  parser.on('text', (text) => output.push(escapeXml(text)));
  parser.on('cdata', (text) => output.push(escapeXml(text)));
  parser.on('comment', (text) => output.push(`<!--${text}-->`));
  parser.write(text.replace(/^\uFEFF/, '')).close();
  return output.join('');
}

/** Read date serials before ExcelJS converts them to JS Dates (which cannot
 * represent Excel's fictitious 1900-02-29). Resolve sheets by relationships. */
export function originalDateSerials(files: Record<string, Uint8Array>) {
  const sheetIds: string[] = [];
  let offset = 0;
  const workbook = new SaxesParser();
  workbook.on('opentag', (node) => {
    if (node.name === 'sheet') sheetIds.push(node.attributes['r:id']);
    if (
      node.name === 'workbookPr' &&
      ['1', 'true'].includes(node.attributes.date1904)
    )
      offset = 1462;
  });
  workbook.write(strFromU8(files['xl/workbook.xml'])).close();
  const paths = new Map<string, string>();
  const rels = new SaxesParser();
  rels.on('opentag', (node) => {
    if (
      node.name === 'Relationship' &&
      node.attributes.TargetMode !== 'External'
    )
      paths.set(node.attributes.Id, `xl/${node.attributes.Target}`);
  });
  if (files['xl/_rels/workbook.xml.rels'])
    rels.write(strFromU8(files['xl/_rels/workbook.xml.rels'])).close();
  return sheetIds.map((id) => {
    const numbers = new Map<string, number>();
    const bytes = files[paths.get(id) ?? ''];
    if (!bytes) return { numbers, offset };
    const parser = new SaxesParser();
    let address = '';
    let value = '';
    let reading = false;
    parser.on('opentag', (node) => {
      if (node.name === 'c')
        address =
          !node.attributes.t || node.attributes.t === 'n'
            ? node.attributes.r
            : '';
      if (node.name === 'v') {
        reading = true;
        value = '';
      }
    });
    parser.on('text', (text) => {
      if (reading) value += text;
    });
    parser.on('closetag', (node) => {
      if (node.name === 'v') {
        reading = false;
        if (address && value.trim() && Number.isFinite(Number(value)))
          numbers.set(address, Number(value));
      }
    });
    parser.write(strFromU8(bytes)).close();
    return { numbers, offset };
  });
}
