import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isEntityDragEvent } from '@entity';
import type { Point } from '@macro-inc/graphics';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { createUniqueId } from 'solid-js';
import type { CanvasAssetState } from './create-asset-state';

/** App drag/drop bridge; nothing in the document model knows about DOM or soup. */
export function createCanvasAssetDrop(
  assets: CanvasAssetState,
  point: (x: number, y: number) => Point,
  enabled: () => boolean = () => true
) {
  const id = `canvas-next-${createUniqueId()}`;
  const droppable = createDroppable(id);
  const context = useDragDropContext();
  if (context) {
    const [state, actions] = context;
    actions.onDragEnd((event) => {
      if (!enabled() || !isEntityDragEvent(event) || event.droppable?.id !== id)
        return;
      const entity = event.draggable.data;
      if (entity.type !== 'document') return;
      const coordinates = state.active.sensor?.coordinates.current;
      if (!coordinates) return;
      const asset = {
        id: String(entity.id),
        name: entity.name ?? 'Document',
        fileType: entity.fileType ?? 'unknown',
      };
      const position = point(coordinates.x, coordinates.y);
      const kind = fileTypeToBlockName(asset.fileType);
      if (kind === 'image' || kind === 'video')
        void assets.media(asset, position);
      else assets.document(asset, position);
    });
  }
  return droppable;
}
