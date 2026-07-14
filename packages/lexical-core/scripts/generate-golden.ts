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

// The binary snapshot is shared by the JavaScript and Rust workspaces. Keep a
// single canonical copy in static_assets now that Docker builds use the
// repository root as their shared context.
const binaryPath = `${import.meta.dir}/../../../static_assets/${GOLDEN_FILENAME}`;
await Bun.write(binaryPath, golden);
console.log(`wrote ${golden.byteLength} bytes → ${binaryPath}`);

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
