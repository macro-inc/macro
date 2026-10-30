import { writeFileSync } from 'node:fs';
import { createCanvasSeed } from '../src/features/block-canvas/core/collaboration';

// Keep backend creation on the exact browser-owned persisted Canvas schema.
writeFileSync(
  new URL('../../../static_assets/canvas-golden.1.bin', import.meta.url),
  createCanvasSeed({
    version: 2,
    document: {
      rootId: 'canvas-root',
      items: { 'canvas-root': { id: 'canvas-root', type: 'surface' } },
    },
  })
);
