import { insertShapesCommand, type Point } from '@macro-inc/graphics';
import { createSignal, onCleanup } from 'solid-js';
import type {
  CanvasAsset,
  CanvasAssetSource,
  PreparedMedia,
} from '../core/assets';
import { canEmbedDocument } from '../core/document-display';
import type { CanvasState } from './create-canvas-state';

export function createAssetState(
  state: CanvasState,
  source: CanvasAssetSource
) {
  const [busy, setBusy] = createSignal(0);
  const [playing, setPlaying] = createSignal<string>();
  let generation = 0,
    disposed = false;
  onCleanup(() => {
    disposed = true;
    generation++;
  });
  const appearance = {
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
    opacity: 1,
  };
  const insert = (items: readonly PreparedMedia[], point: Point) => {
    state.chooseTool('select');
    state.editor.execute(
      insertShapesCommand,
      items.map((media, index) => ({
        item: { id: crypto.randomUUID(), ...media, appearance },
        point: {
          x: point.x - media.geometry.width / 2 + index * 24,
          y: point.y - media.geometry.height / 2 + index * 24,
        },
      }))
    );
  };
  async function load(tasks: (() => Promise<PreparedMedia>)[], point: Point) {
    const started = generation;
    setBusy((value) => value + 1);
    state.setNotice('Loading media…');
    try {
      const results = await Promise.allSettled(tasks.map((task) => task()));
      if (disposed || started !== generation) return;
      const media = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      if (media.length) insert(media, point);
      const failed = results.filter(
        (result) => result.status === 'rejected'
      ).length;
      state.setNotice(
        failed
          ? `${media.length} inserted; ${failed} could not be loaded`
          : `Inserted ${media.length} media item${media.length === 1 ? '' : 's'}`
      );
    } finally {
      if (!disposed) setBusy((value) => value - 1);
    }
  }
  return {
    busy,
    playing,
    togglePlayback: (id: string) =>
      setPlaying((current) => (current === id ? undefined : id)),
    stopPlayback: () => setPlaying(undefined),
    cancelPending: () => {
      generation++;
      setPlaying(undefined);
    },
    files: (files: readonly File[], point: Point) =>
      load(
        files.map((file) => () => source.upload(file)),
        point
      ),
    media: (asset: CanvasAsset, point: Point) =>
      load([() => source.media(asset)], point),
    document: (
      asset: CanvasAsset,
      point: Point,
      display: 'preview' | 'embed' = 'preview'
    ) => {
      if (display === 'embed' && !canEmbedDocument(asset.fileType)) return;
      const width = display === 'embed' ? 640 : 340;
      const height = display === 'embed' ? 480 : 136;
      state.chooseTool('select');
      state.editor.execute(insertShapesCommand, [
        {
          item: {
            id: crypto.randomUUID(),
            type: 'document',
            appearance,
            geometry: {
              documentId: asset.id,
              name: asset.name,
              fileType: asset.fileType,
              width,
              height,
              display,
            },
          },
          point: { x: point.x - width / 2, y: point.y - height / 2 },
        },
      ]);
      state.setNotice(
        display === 'embed'
          ? 'Inserted full embed — double-click to interact'
          : 'Inserted document preview'
      );
    },
  };
}
export type CanvasAssetState = ReturnType<typeof createAssetState>;
