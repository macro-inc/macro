import { SaxesParser, type SaxesTagNS } from 'saxes';
import type { XlsxArchive } from './xlsx-archive';

export type Attributes = Record<string, string>;

export function attributes(node: SaxesTagNS): Attributes {
  const result: Attributes = {};
  for (const attribute of Object.values(node.attributes))
    result[attribute.local] = attribute.value;
  return result;
}

/** Feed UTF-8 bytes to a parser in chunks so huge sheets never become one string. */
export function parse(
  bytes: Uint8Array,
  name: string,
  setup: (parser: SaxesParser<{ xmlns: true }>) => void
) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error(`Unsupported XML document type in ${name}.`);
  });
  parser.on('error', () => {
    throw new Error(`Invalid XML in ${name}.`);
  });
  setup(parser);
  // Some writers leave optional parts (styles, shared strings) empty.
  if (!bytes.some((byte) => byte > 32)) return;
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });
  const chunk = 1 << 20;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    parser.write(
      decoder.decode(bytes.subarray(offset, offset + chunk), { stream: true })
    );
  parser.write(decoder.decode());
  parser.close();
}

/** Resolve a relationship target relative to its source part. */
export function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** A part's relationships by id, with targets resolved to archive paths. */
export function relationships(archive: XlsxArchive, part: string) {
  const path = resolvePath(part, `_rels/${part.split('/').at(-1)}.rels`);
  const bytes = archive.read(path);
  const result = new Map<
    string,
    { target: string; type: string; external: boolean }
  >();
  if (!bytes) return result;
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      if (node.local !== 'Relationship') return;
      const value = attributes(node);
      const external = value.TargetMode === 'External';
      result.set(value.Id, {
        target: external ? value.Target : resolvePath(part, value.Target ?? ''),
        type: value.Type?.split('/').at(-1) ?? '',
        external,
      });
    });
  });
  return result;
}
