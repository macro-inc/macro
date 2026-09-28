import { corners, intersects, transformPoint } from '../affine';
import type { ShapeGeometryMap, ShapeItem } from '../model';
import { type BoxGeometry, validBoxGeometry } from './box-geometry';
import type { ShapeDefinition } from './definition';

/** Stable references only. Signed URLs, upload progress and players belong to hosts. */
export type MediaSource =
  | Readonly<{ type: 'document' | 'static'; id: string }>
  | Readonly<{ type: 'url'; url: string }>;
export type MediaGeometry = BoxGeometry &
  Readonly<{ source: MediaSource; name: string }>;
export type DocumentGeometry = BoxGeometry &
  Readonly<{
    documentId: string;
    name: string;
    fileType: string;
    display?: 'preview' | 'embed';
  }>;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object';
export const validMediaSource = (v: unknown): v is MediaSource =>
  record(v) &&
  (((v.type === 'document' || v.type === 'static') &&
    typeof v.id === 'string' &&
    !!v.id.trim()) ||
    (v.type === 'url' &&
      typeof v.url === 'string' &&
      /^(https?:\/\/|\/(?!\/))[^\s]+$/i.test(v.url)));
function definition<K extends 'image' | 'video' | 'document'>(
  type: K,
  label: string,
  validate: (v: unknown) => v is ShapeGeometryMap[K]
): ShapeDefinition<K> {
  const bounds = (item: ShapeItem<K>) => ({
    x: 0,
    y: 0,
    width: item.geometry.width,
    height: item.geometry.height,
  });
  return {
    type,
    label,
    validateGeometry: validate,
    freezeGeometry: (g) =>
      Object.freeze({
        ...g,
        ...('source' in g ? { source: Object.freeze({ ...g.source }) } : {}),
      }) as ShapeGeometryMap[K],
    bounds,
    sameGeometry: (a, b) =>
      JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
    hitTest: (item, p) =>
      (item.appearance.opacity ?? 1) > 0 &&
      p.x >= 0 &&
      p.y >= 0 &&
      p.x <= item.geometry.width &&
      p.y <= item.geometry.height,
    intersectsBox: (item, world, box) =>
      intersects(
        corners(bounds(item)).map((p) => transformPoint(world, p)),
        corners(box)
      ),
    resize: (item, size) => ({
      ...item,
      geometry: { ...item.geometry, width: size.width, height: size.height },
    }),
  };
}
const validMedia = (v: unknown): v is MediaGeometry =>
  validBoxGeometry(v) &&
  'source' in v &&
  validMediaSource(v.source) &&
  'name' in v &&
  typeof v.name === 'string';
export const imageDefinition = definition('image', 'Image', validMedia);
export const videoDefinition = definition('video', 'Video', validMedia);
export const documentDefinition = definition(
  'document',
  'Document',
  (v): v is DocumentGeometry =>
    validBoxGeometry(v) &&
    'documentId' in v &&
    typeof v.documentId === 'string' &&
    !!v.documentId.trim() &&
    'fileType' in v &&
    typeof v.fileType === 'string' &&
    !!v.fileType.trim() &&
    (!('display' in v) ||
      v.display === undefined ||
      v.display === 'preview' ||
      v.display === 'embed') &&
    'name' in v &&
    typeof v.name === 'string'
);
