import {
  createContext,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import type { Store } from 'solid-js/store';
import type { WordcountStats } from '../../plugins';

type WordcountContextValue = {
  stats: Store<WordcountStats>;
};

const WordcountContext = createContext<WordcountContextValue>();

function useWordcountContext(): WordcountContextValue {
  const ctx = useContext(WordcountContext);
  if (!ctx) {
    throw new Error(
      'Wordcount compound components must be used within <Wordcount.Root>'
    );
  }
  return ctx;
}

function Root(props: ParentProps<{ stats: Store<WordcountStats> }>) {
  return (
    <WordcountContext.Provider value={{ stats: props.stats }}>
      {props.children}
    </WordcountContext.Provider>
  );
}

/**
 * Renders the word count, showing selected/total when text is selected.
 */
function Words(props: { class?: string }): JSX.Element {
  const { stats } = useWordcountContext();

  return (
    <span class={props.class}>
      <Show
        when={stats.selectedWords !== null}
        fallback={<span>{stats.totalWords.toLocaleString()}</span>}
      >
        <span>{stats.selectedWords?.toLocaleString()}</span>
        <span class="opacity-50"> / {stats.totalWords.toLocaleString()}</span>
      </Show>
    </span>
  );
}

/**
 * Renders the character count, showing selected/total when text is selected.
 */
function Characters(props: { class?: string }): JSX.Element {
  const { stats } = useWordcountContext();

  return (
    <span class={props.class}>
      <Show
        when={stats.selectedCharacters !== null}
        fallback={<span>{stats.totalCharacters.toLocaleString()}</span>}
      >
        <span>{stats.selectedCharacters?.toLocaleString()}</span>
        <span class="opacity-50">
          {' '}
          / {stats.totalCharacters.toLocaleString()}
        </span>
      </Show>
    </span>
  );
}

/**
 * Simple word count value (selected if available, otherwise total).
 */
function SimpleWordCount(props: { class?: string }): JSX.Element {
  const { stats } = useWordcountContext();
  const count = () =>
    stats.selectedWords !== null ? stats.selectedWords : stats.totalWords;

  return <span class={props.class}>{count().toLocaleString()}</span>;
}

/**
 * Renders "word" or "words" based on count (for labels).
 */
function WordLabel(): JSX.Element {
  const { stats } = useWordcountContext();
  const count = () =>
    stats.selectedWords !== null ? stats.selectedWords : stats.totalWords;

  return <>{count() === 1 ? 'word' : 'words'}</>;
}

/**
 * Simple character count value (selected if available, otherwise total).
 */
function SimpleCharacterCount(props: { class?: string }): JSX.Element {
  const { stats } = useWordcountContext();
  const count = () =>
    stats.selectedCharacters !== null
      ? stats.selectedCharacters
      : stats.totalCharacters;

  return <span class={props.class}>{count().toLocaleString()}</span>;
}

/**
 * Renders "character" or "characters" based on count (for labels).
 */
function CharacterLabel(): JSX.Element {
  const { stats } = useWordcountContext();
  const count = () =>
    stats.selectedCharacters !== null
      ? stats.selectedCharacters
      : stats.totalCharacters;

  return <>{count() === 1 ? 'character' : 'characters'}</>;
}

export const Wordcount = {
  Root,
  Words,
  Characters,
  SimpleWordCount,
  WordLabel,
  SimpleCharacterCount,
  CharacterLabel,
};
