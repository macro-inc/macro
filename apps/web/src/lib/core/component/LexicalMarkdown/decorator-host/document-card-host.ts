import type {
  DocumentCardDecoratorProps,
  PreviewBox,
} from '@macro-inc/lexical-core';
import type { Owner } from 'solid-js';

export type DocumentCardPreview = NonNullable<
  DocumentCardDecoratorProps['previewComponent']
>;
/** Actual editor, durable-id and preview-registry operations used by card UI. */
export interface DocumentCardHost {
  available(): boolean;
  isSelected(key: string): boolean;
  isEditable(): boolean;
  isInteractable(): boolean;
  readonly skipPreviewFetch: boolean;
  readonly previewOwner: Owner | null;
  registerEditableListener(
    listener: (editable: boolean) => void
  ): (() => void) | undefined;
  layoutChanged?(): void;
  select(key: string): void;
  remove(key: string): void;
  convertToMention(key: string, selectEnd?: boolean): void;
  setPreviewHeight(key: string, height: string): void;
  setCanvasLocation(
    key: string,
    location: { x: number; y: number; scale: number }
  ): void;
  setPreviewBox(key: string, box: PreviewBox): void;
  setBlockParams(key: string, params: Record<string, string>): void;
  observeBlockParams(
    key: string,
    listener: (params: Record<string, string>) => void
  ): (() => void) | undefined;
  updateDocumentNames(names: Record<string, string>): void;
  nodeId(key: string): string | null | undefined;
  cachePreview(
    id: string,
    component: DocumentCardPreview,
    dispose: () => void
  ): void;
  clearPreview(id: string): void;
}
