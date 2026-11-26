import type { canvasSyncSource as productionCanvasSource } from '@app/features/block-canvas/queries/canvas-sync';

// An unshared read-only canvas has a local scene and a live camera. Only
// the host markdown document is shared by the two fixture clients.
export const canvasSyncSource: typeof productionCanvasSource = () => ({
  canWrite: () => false,
  authorize: async () => {},
  exists: async () => false,
  initialize: async () => {
    throw new Error('The fixture canvas is read-only.');
  },
  connect: () => {
    throw new Error('The fixture canvas is unshared.');
  },
});
