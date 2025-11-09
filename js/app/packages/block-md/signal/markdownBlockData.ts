import { blockDataSignalAs, createBlockStore } from '@core/block';
import type {
  PluginManager,
  SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import type { LexicalEditor } from 'lexical';
import type { Store } from 'solid-js/store';
import type { MarkdownData } from '../definition';

export const blockDataSignal = blockDataSignalAs<MarkdownData>('md');

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
 */
export type MdData = {
  editor?: LexicalEditor;
  titleEditor?: LexicalEditor;
  plugins?: PluginManager;
  selection?: Store<SelectionData>;
  notebook?: HTMLElement;
  scrollContainer?: HTMLElement;
  commentMargin?: HTMLElement;
  contentRef?: HTMLElement;
};

export const mdStore = createBlockStore<MdData>({});
