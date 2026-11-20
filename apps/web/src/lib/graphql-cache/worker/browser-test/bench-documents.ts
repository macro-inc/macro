/**
 * Prints the app's generated GraphQL operations and fragments, one
 * `<Name>.graphql` / `<Name>.fragment.graphql` file each, for
 * `cargo run -p cache-bench -- generate --documents <dir>`.
 *
 * Usage (from apps/web): node src/lib/graphql-cache/worker/browser-test/bench-documents.ts <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type DocumentNode, print } from 'graphql';
import * as generated from '../../../service-clients/service-storage/graphql/generated/graphql.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: bench-documents.ts <dir>');
mkdirSync(out, { recursive: true });

function fileName(exportName: string): string | undefined {
  if (exportName.endsWith('FragmentDoc'))
    return `${exportName.slice(0, -'FragmentDoc'.length)}.fragment.graphql`;
  if (exportName.endsWith('Document'))
    return `${exportName.slice(0, -'Document'.length)}.graphql`;
  return undefined;
}

let written = 0;
for (const [exportName, value] of Object.entries(generated)) {
  const document = value as Partial<DocumentNode> | null;
  if (typeof document !== 'object' || document?.kind !== 'Document') continue;
  const name = fileName(exportName);
  if (!name) continue;
  writeFileSync(resolve(out, name), print(document as DocumentNode));
  written++;
}
console.log(`wrote ${written} documents to ${out}`);
