import type { EditorType, NodeIdMappings } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import { createContext, type Owner } from 'solid-js';
import type { Store } from 'solid-js/store';
import type { PluginManager, SelectionData } from '../plugins';

export type LexicalWrapperBase = {
  type: EditorType;
  /** Owner of the editor lifecycle, stable across decorator replacement. */
  owner: Owner | null;
  plugins: PluginManager;
  editor: LexicalEditor;
  cleanup: () => void;
  isInteractable: () => boolean;
  selection?: Store<SelectionData>;
  /** When true, decorator components should skip backend fetches (e.g. preview API). */
  skipPreviewFetch?: boolean;
};

export type LexicalWrapperWithMapping = LexicalWrapperBase & {
  mapping: NodeIdMappings;
};

export type LexicalWrapper = LexicalWrapperBase | LexicalWrapperWithMapping;

export const LexicalWrapperContext = createContext<LexicalWrapper>();

export function isWrapperWithIds(
  wrapper: LexicalWrapper | undefined
): wrapper is LexicalWrapperWithMapping {
  return Boolean(
    wrapper && 'mapping' in wrapper && wrapper['mapping'] !== undefined
  );
}
