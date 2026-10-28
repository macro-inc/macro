import { describe, expect, it, vi } from 'vitest';
import {
  describedArtboardCount,
  describedLayerCount,
  readIllustratorDocumentHandler,
  readPhotoshopDocumentHandler,
} from './DesignDocument';

// The document chip pulls in the app's live clients; these tests need none.
vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));

describe('Photoshop and Illustrator document tools', () => {
  it('reads the layer count from a Photoshop description', () => {
    expect(
      describedLayerCount(
        'Photoshop document: 64 × 48 px, Rgb 8-bit, 72 ppi, 4 layers\nLayers (top to bottom):'
      )
    ).toBe(4);
    expect(
      describedLayerCount(
        'Photoshop document: 10 × 10 px, Rgb 8-bit, 72 ppi, 1 layer'
      )
    ).toBe(1);
    expect(describedLayerCount('Layers (top to bottom):')).toBeUndefined();
    expect(readPhotoshopDocumentHandler.handleResponse).toBeUndefined();
  });

  it('reads the artboard count from an Illustrator description', () => {
    expect(
      describedArtboardCount(
        'Illustrator document: 3 artboards, 2 layers\n- Artboard "Cover"'
      )
    ).toBe(3);
    expect(
      describedArtboardCount('Illustrator document: 1 artboard, 1 layer')
    ).toBe(1);
    expect(describedArtboardCount('- Artboard "Cover" (id 1)')).toBeUndefined();
    expect(readIllustratorDocumentHandler.handleResponse).toBeUndefined();
  });
});
