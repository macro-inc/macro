/**
 * Build-time generator for the canonical "blank lexical markdown" Loro snapshot.
 */

import { markdownToLoroSnapshot } from '../markdown-loro-snapshot';

const golden = await markdownToLoroSnapshot('');
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
