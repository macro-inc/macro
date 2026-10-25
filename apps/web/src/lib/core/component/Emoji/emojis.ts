import { fireAndForget } from '@core/util/fireAndForget';
import { createMemo, createSignal } from 'solid-js';
import type { SimpleEmoji } from './emoji-catalog';

export type { SimpleEmoji } from './emoji-catalog';

type EmojiCatalog = typeof import('./emoji-catalog');

// The emoji tables are several hundred KB, so they load as their own chunk the
// first time a picker or the `:` menu reads them rather than at app start.
const [catalog, setCatalog] = createSignal<EmojiCatalog>();
let catalogRequested = false;

async function importEmojiCatalog(): Promise<void> {
  const module = await import('./emoji-catalog');
  setCatalog(() => module);
}

// Every read starts the load, so the guard keeps a failed chunk to one report
// rather than one per reader.
function loadEmojiCatalog(): void {
  if (catalogRequested) return;
  catalogRequested = true;
  fireAndForget(importEmojiCatalog(), 'emoji-catalog');
}

/** Resolves `:shortcode:` once the catalog has loaded; starts the load otherwise. */
export function resolveEmoji(key: string): string | undefined {
  const loaded = catalog();
  if (!loaded) {
    loadEmojiCatalog();
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
      loadEmojiCatalog();
      return groups();
    },
    emojis: () => {
      loadEmojiCatalog();
      return emojis();
    },
    filter: (query: string) => {
      setQuery(query);
    },
  };
};
