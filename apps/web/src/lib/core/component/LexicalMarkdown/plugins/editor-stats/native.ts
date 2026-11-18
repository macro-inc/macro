import type {
  EditorView,
  LatestPublishedObserver,
} from '@macro-inc/lexical-wasm-view';
import { debounce } from '@solid-primitives/scheduled';
import type { SetStoreFunction } from 'solid-js/store';
import { z } from 'zod';
import { queryApplication } from '../group-b/command';
import type { ProgressStats } from '../progress/progressPlugin';
import {
  setWordcountStats,
  type WordcountStats,
} from '../wordcount/wordcountPlugin';

const STATS = z.object({
  text: z.string(),
  selected: z.string().nullable(),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

function readStats(view: EditorView) {
  return STATS.parse(queryApplication(view, 'group-b.document-stats', {}));
}

/**
 * Native wordcountPlugin and progressPlugin: both run on every published
 * update (selection-only included), word counts after the same debounce.
 */
export function createNativeEditorStats(props: {
  setWordcount: SetStoreFunction<WordcountStats>;
  setProgress: SetStoreFunction<ProgressStats>;
  debounceTime: number;
}): LatestPublishedObserver {
  let view: EditorView | undefined;
  let queued = false;
  const countWords = debounce(() => {
    if (!view?.isMounted) return;
    const stats = readStats(view);
    setWordcountStats(props.setWordcount, stats.text, stats.selected);
  }, props.debounceTime);
  const retire = () => {
    view = undefined;
    countWords.clear();
  };
  return {
    published(next) {
      view = next;
      countWords();
      if (queued) return;
      queued = true;
      // Read after the drain; observers must not reenter the session.
      queueMicrotask(() => {
        queued = false;
        if (!view?.isMounted) return;
        const { progress } = readStats(view);
        props.setProgress('completed', progress.completed);
        props.setProgress('total', progress.total);
      });
    },
    unavailable: retire,
    retired: retire,
  };
}
