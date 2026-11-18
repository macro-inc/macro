import { debounce } from '@solid-primitives/scheduled';
import {
  $getRoot,
  $getSelection,
  type LexicalEditor,
  type UpdateListener,
} from 'lexical';
import { createStore, type SetStoreFunction } from 'solid-js/store';

const segmenter = new Intl.Segmenter('en-US', {
  granularity: 'word',
});

export type WordcountStats = {
  totalWords: number;
  totalCharacters: number;
  selectedWords: number | null;
  selectedCharacters: number | null;
};

export function createWordcountStatsStore() {
  return createStore<WordcountStats>({
    totalWords: 0,
    totalCharacters: 0,
    selectedWords: null,
    selectedCharacters: null,
  });
}

function countWordLike(text: string) {
  let wordCount = 0;
  for (const seg of segmenter.segment(text)) {
    if (seg.isWordLike) wordCount++;
  }
  return wordCount;
}

/** Store totals for root text and the selection's text; empty selections clear. */
export function setWordcountStats(
  setStore: SetStoreFunction<WordcountStats>,
  all: string,
  selected: string | null
) {
  setStore('totalWords', countWordLike(all));
  setStore('totalCharacters', all.length);
  if (selected) {
    setStore('selectedWords', countWordLike(selected));
    setStore('selectedCharacters', selected.length);
  } else {
    setStore('selectedWords', null);
    setStore('selectedCharacters', null);
  }
}

type WordcountPluginProps = {
  setStore: SetStoreFunction<WordcountStats>;
  debounceTime: number;
};

function registerWordcountPlugin(
  editor: LexicalEditor,
  props: WordcountPluginProps
) {
  const countWords: UpdateListener = ({ editorState }) => {
    const [all, selected] = editorState.read(() => {
      const root = $getRoot();
      let childText = root.getChildren().map((child) => child.getTextContent());
      return [childText.join('\n'), $getSelection()?.getTextContent() ?? null];
    });
    setWordcountStats(props.setStore, all, selected);
  };

  const deboundecCountWords = debounce(countWords, props.debounceTime);
  return editor.registerUpdateListener(deboundecCountWords);
}
export function wordcountPlugin(props: WordcountPluginProps) {
  return (editor: LexicalEditor) => registerWordcountPlugin(editor, props);
}
