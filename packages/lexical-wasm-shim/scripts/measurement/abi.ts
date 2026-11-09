import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export interface AbiSignature {
  readonly parameters: readonly string[];
  readonly results: readonly string[];
}
export interface AbiImport extends AbiSignature {
  readonly module: string;
  readonly name: string;
}
export interface ModuleAbi {
  readonly imports: readonly AbiImport[];
  readonly exports: Readonly<Record<string, AbiSignature>>;
  readonly tables: readonly string[];
}
export function widths(types: readonly string[]): {
  bytes: number;
  refs: number;
} {
  let bytes = 0;
  let refs = 0;
  for (const type of types) {
    if (type === 'i32' || type === 'f32') bytes += 4;
    else if (type === 'i64' || type === 'f64') bytes += 8;
    else if (type === 'v128') bytes += 16;
    else if (type === 'externref' || type === 'funcref') refs++;
    else throw new Error(`Unaccounted WASM ABI type: ${type}`);
  }
  return { bytes, refs };
}
function signature(header: string): AbiSignature {
  const parameters: string[] = [];
  const results: string[] = [];
  for (const match of header.matchAll(/\((param|result)\s+([^()]*)\)/g)) {
    const target = match[1] === 'param' ? parameters : results;
    target.push(
      ...match[2]
        .trim()
        .split(/\s+/)
        .filter((part) => !part.startsWith('$'))
    );
  }
  const remainder = header.replace(/\((?:param|result)\s+[^()]*\)/g, '');
  if (/\((param|result|type)\b/.test(remainder))
    throw new Error(`Unsupported disassembler signature: ${header}`);
  widths(parameters);
  widths(results);
  return { parameters, results };
}

/** Read Binaryen wasm-dis output; unsupported signatures fail rather than guess. */
export async function readModuleAbi(stream: Readable): Promise<ModuleAbi> {
  const functions = new Map<string, AbiSignature>();
  const exported: { name: string; functionId: string }[] = [];
  const imports: AbiImport[] = [];
  const tables: string[] = [];
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    if (line.startsWith(' (import ')) {
      const imported =
        /^ \(import ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*") \(func (\$[^\s()]+)(.*)/.exec(
          line
        );
      if (imported === null)
        throw new Error(`Unsupported nonfunction WASM import: ${line}`);
      // JSON.parse is checked below; module/name are not trusted compiler objects.
      const module: unknown = JSON.parse(imported[1]);
      const name: unknown = JSON.parse(imported[2]);
      if (typeof module !== 'string' || typeof name !== 'string')
        throw new Error('Invalid WASM import name');
      const type = signature(imported[4]);
      functions.set(imported[3], type);
      imports.push({ module, name, ...type });
    } else if (line.startsWith(' (func ')) {
      const declared = /^ \(func (\$[^\s()]+)(.*)/.exec(line);
      if (declared === null)
        throw new Error('Unsupported WASM function header');
      functions.set(declared[1], signature(declared[2]));
    } else if (line.startsWith(' (export ')) {
      const entry =
        /^ \(export ("(?:[^"\\]|\\.)*") \(func (\$[^\s()]+)\)\)$/.exec(line);
      if (entry === null) {
        const table =
          /^ \(export ("(?:[^"\\]|\\.)*") \(table \$[^\s()]+\)\)$/.exec(line);
        if (table !== null) {
          const name: unknown = JSON.parse(table[1]);
          if (typeof name !== 'string')
            throw new Error('Invalid WASM table export name');
          tables.push(name);
          continue;
        }
        if (!/\((?:memory|table|global) /.test(line))
          throw new Error(`Unsupported WASM export: ${line}`);
        continue;
      }
      const name: unknown = JSON.parse(entry[1]);
      if (typeof name !== 'string') throw new Error('Invalid WASM export name');
      exported.push({ name, functionId: entry[2] });
    }
  }
  const exports: Record<string, AbiSignature> = {};
  for (const entry of exported) {
    const type = functions.get(entry.functionId);
    if (type === undefined)
      throw new Error(`Missing WASM export signature: ${entry.name}`);
    if (Object.hasOwn(exports, entry.name))
      throw new Error('Duplicate WASM export');
    Object.defineProperty(exports, entry.name, {
      value: type,
      enumerable: true,
    });
  }
  if (exported.length === 0) throw new Error('No WASM function exports');
  return { imports, exports, tables };
}
