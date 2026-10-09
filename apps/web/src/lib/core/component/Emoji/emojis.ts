import { createMemo, createSignal } from 'solid-js';
import type { SimpleEmoji } from './emoji-catalog';

export type { SimpleEmoji } from './emoji-catalog';

type EmojiCatalog = typeof import('./emoji-catalog');

// The emoji tables are several hundred KB, so they load as their own chunk the
// first time a picker or the `:` menu reads them rather than at app start.
const [catalog, setCatalog] = createSignal<EmojiCatalog>();
let catalogLoad: Promise<EmojiCatalog> | undefined;

function loadEmojiCatalog(): Promise<EmojiCatalog> {
  catalogLoad ??= import('./emoji-catalog').then((module) => {
    setCatalog(() => module);
    return module;
  });
  return catalogLoad;
}

/** Resolves `:shortcode:` once the catalog has loaded; starts the load otherwise. */
export function resolveEmoji(key: string): string | undefined {
  const loaded = catalog();
  if (!loaded) {
    void loadEmojiCatalog();
    return undefined;
  }
  return loaded.resolveEmoji(key);
}

export const useEmojiData = () => {
  const [query, setQuery] = createSignal('');

  const emojis = createMemo(
    (): SimpleEmoji[] => catalog()?.emojisForQuery(query()) ?? []
  );
  const groups = createMemo(() => catalog()?.emojiGroups() ?? []);

  return {
    groups: () => {
      void loadEmojiCatalog();
      return groups();
    },
    emojis: () => {
      void loadEmojiCatalog();
      return emojis();
    },
    filter: (query: string) => {
      setQuery(query);
    },
  };
};
