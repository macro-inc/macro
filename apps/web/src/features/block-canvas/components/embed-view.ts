import type { DocumentGeometry } from '@macro-inc/graphics';
export type CanvasEmbedViewProps = {
  geometry: DocumentGeometry;
  active: boolean;
  onExit: () => void;
};
