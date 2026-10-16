import type { GraphicsDocument } from './model';

/** An authoritative document/history owner. The editor only proposes commits. */
export interface GraphicsBackend {
  getDocument(): GraphicsDocument;
  getHistory(): { canUndo: boolean; canRedo: boolean };
  commit(document: GraphicsDocument): void;
  undo(): void;
  redo(): void;
  subscribe(
    listener: (source: 'local' | 'remote' | 'history') => void
  ): () => void;
}
