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

    const segments = segmenter.segment(all);
    let wordCount = 0;
    for (const seg of segments) {
      if (seg.isWordLike) {
        wordCount++;
      }
    }

    props.setStore('totalWords', wordCount);
    props.setStore('totalCharacters', all.length);

    if (selected) {
      const segments = segmenter.segment(selected);
      let wordCount = 0;
      for (const seg of segments) {
        if (seg.isWordLike) wordCount++;
      }
      props.setStore('selectedWords', wordCount);
      props.setStore('selectedCharacters', selected.length);
    } else {
      props.setStore('selectedWords', null);
      props.setStore('selectedCharacters', null);
    }
  };

  const deboundecCountWords = debounce(countWords, props.debounceTime);
  return editor.registerUpdateListener(deboundecCountWords);
}
export function wordcountPlugin(props: WordcountPluginProps) {
  return (editor: LexicalEditor) => registerWordcountPlugin(editor, props);
}
