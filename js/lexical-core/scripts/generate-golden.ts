/**
 * Build-time generator for the canonical "blank lexical markdown" Loro snapshot.
 */

import {
  markdownToSerializedEditorState,
  rawMarkdownStateToLoroSnapshot,
} from '../markdown-loro-snapshot';

// Build from scratch (no golden base) — this script *produces* the golden, so
// it must not seed from it. Runtime callers go through markdownToLoroSnapshot,
// which does seed from the golden.
const emptyState = markdownToSerializedEditorState('');
const golden = await rawMarkdownStateToLoroSnapshot(emptyState as any);
if (!golden) {
  console.error('snapshot generation returned undefined');
  process.exit(1);
}

// Hardcoded version suffix to bust caches if we ever care to
const GOLDEN_FILENAME = 'markdown-golden.1.bin';

// Copies need to land in multiple places because each Rust crate's Docker
// build context is its own directory — include_bytes! can't reach outside
// the context, so the file has to be physically present inside each one.
const OUT_PATHS = [
  `${import.meta.dir}/../${GOLDEN_FILENAME}`,
  `${import.meta.dir}/../../../rust/cloud-storage/${GOLDEN_FILENAME}`,
  `${import.meta.dir}/../../../rust/sync-service/${GOLDEN_FILENAME}`,
];

for (const outPath of OUT_PATHS) {
  await Bun.write(outPath, golden);
  console.log(`wrote ${golden.byteLength} bytes → ${outPath}`);
}

// Also emit a TS byte-literal so the snapshot can be imported directly in any
// runtime (Cloudflare Worker, node, browser) without a bundler-specific asset
// loader. This is the module the runtime code actually imports.
const bytes = Array.from(golden);
const lines: string[] = [];
for (let i = 0; i < bytes.length; i += 20) {
  lines.push(`  ${bytes.slice(i, i + 20).join(', ')},`);
}
const tsModule = `// AUTO-GENERATED from ${GOLDEN_FILENAME} — do not edit by hand.
// Canonical blank-markdown Loro "golden" snapshot, inlined as a byte literal so
// it can be imported directly in any runtime (Cloudflare Worker, node, browser)
// without a bundler-specific asset loader.
export const MARKDOWN_GOLDEN: Uint8Array = new Uint8Array([
${lines.join('\n')}
]);
`;
const tsPath = `${import.meta.dir}/../markdown-golden.1.ts`;
await Bun.write(tsPath, tsModule);
console.log(`wrote ${bytes.length} bytes → ${tsPath}`);
