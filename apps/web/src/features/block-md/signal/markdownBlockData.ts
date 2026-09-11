import type {
  PluginManager,
  ProgressStats,
  SelectionData,
  WordcountStats,
} from '@core/component/LexicalMarkdown/plugins';
import type { NodeIdMappings } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import type { LexicalEditor } from 'lexical';
import type { Store } from 'solid-js/store';
import { useMarkdownDocument } from '../context/markdown-document-context';

export const useMarkdownData = () => useMarkdownDocument().data;

/**
 * Store for the data and helpful ui refs for the Notebook/MD block
 * @property editor The Editor instance
 * @property titleEditor The Editor instance for the title
 * @property plugins The plugin manager for the main editor
 * @property selection A store with the processed selection data
 * @property notebook The notbook ref which is the direct containing parent of the two editors and is
 *     clamped to a max width.
 * @property scrollContainer The scroll container is the direct sibling of the top bar
 *     and takes the full width of the block. This is where the scroll bar is attached.
 * @property locationReady True after the editor is initialized and the first
 *     location-scroll window has opened.
 */
export type MdData = {
  editor?: LexicalEditor;
  /** Durable nodeId <-> nodeKey mapping for the main editor (from the nodeId plugin). */
  mapping?: NodeIdMappings;
  titleEditor?: LexicalEditor;
  plugins?: PluginManager;
  selection?: Store<SelectionData>;
  wordcountStats?: Store<WordcountStats>;
  progressStats?: Store<ProgressStats>;
  notebook?: HTMLElement;
  scrollContainer?: HTMLElement;
  commentMargin?: HTMLElement;
  contentRef?: HTMLElement;
  locationReady?: boolean;
};

export function useMdStore() {
  const { md, setMd } = useMarkdownDocument().state.editor;
  return [md, setMd] as const;
}

export function useIsTask() {
  const data = useMarkdownData();
  return () => data()?.documentMetadata.subType === 'task';
}
