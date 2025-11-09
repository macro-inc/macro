import type { BlockName } from '@core/block';
import { blockNameToMimeTypes } from '@core/constant/allBlocks';

export function newBlankDocument(blockName: BlockName) {
  const encoder = new TextEncoder();
  switch (blockName) {
    case 'md':
      return new File([encoder.encode('')], '', {
        type: blockNameToMimeTypes[blockName]?.[0],
      });
    case 'canvas':
      return new File(
        [encoder.encode('{"nodes": [],"edges": [],"groups": []}')],
        'New Canvas.canvas',
        { type: blockNameToMimeTypes[blockName]?.[0] }
      );
    default:
      return null;
  }
}
