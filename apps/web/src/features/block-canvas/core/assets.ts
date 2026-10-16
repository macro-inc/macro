import type { MediaGeometry } from '@macro-inc/graphics';
export type CanvasAsset = { id: string; name: string; fileType: string };
export type PreparedMedia = {
  type: 'image' | 'video';
  geometry: MediaGeometry;
};
export type CanvasAssetSource = {
  upload(file: File): Promise<PreparedMedia>;
  media(asset: CanvasAsset): Promise<PreparedMedia>;
};
