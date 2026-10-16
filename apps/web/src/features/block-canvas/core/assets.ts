import type { MediaGeometry } from '@macro-inc/graphics';
export type CanvasAsset = { id: string; name: string; fileType: string };
export type PreparedMedia = {
  type: 'image' | 'video';
  geometry: MediaGeometry;
};
export type LocalMediaPreview = {
  media: PreparedMedia;
  dispose: () => void;
};
export type CanvasAssetSource = {
  // The receiver owns the preview URL until it calls dispose, including on failure.
  upload(
    file: File,
    onPreview?: (preview: LocalMediaPreview) => void
  ): Promise<PreparedMedia>;
  media(asset: CanvasAsset): Promise<PreparedMedia>;
};
