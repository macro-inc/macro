import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { debounce } from '@solid-primitives/scheduled';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { DatabaseSearchGroup } from '../core/database-search';

export type DatabaseSearchResults =
  | { status: 'idle' }
  | { status: 'searching'; groups: DatabaseSearchGroup[] }
  | { status: 'ready'; groups: DatabaseSearchGroup[] }
  | { status: 'failed' };

const TYPING_PAUSE_MS = 200;

/**
 * The database's one search: its term, whether it is open, and the matches
 * the last finished search found. It outlives table switches, so a result
 * in another table can be chosen and the search reopened where it was.
 */
export function createDatabaseSearch(options: {
  detail: Accessor<DatabaseDetail | undefined>;
  search: (
    detail: DatabaseDetail,
    term: string
  ) => ResultAsync<DatabaseSearchGroup[], unknown>;
}) {
  const [term, setTermSignal] = createSignal('');
  const [isOpen, setOpen] = createSignal(false);
  const [results, setResults] = createSignal<DatabaseSearchResults>({
    status: 'idle',
  });
  let input: HTMLInputElement | undefined;
  let returnFocus: HTMLElement | undefined;
  let generation = 0;

  const run = debounce((value: string) => {
    const detail = options.detail();
    if (!detail) return;
    const current = ++generation;
    void options.search(detail, value).match(
      (groups) => {
        if (current === generation) setResults({ status: 'ready', groups });
      },
      () => {
        if (current === generation) setResults({ status: 'failed' });
      }
    );
  }, TYPING_PAUSE_MS);
  onCleanup(() => {
    run.clear();
    generation += 1;
  });

  function setTerm(value: string) {
    setTermSignal(value);
    if (!value.trim()) {
      run.clear();
      generation += 1;
      setResults({ status: 'idle' });
      return;
    }
    const previous = results();
    setResults({
      status: 'searching',
      groups:
        previous.status === 'ready' || previous.status === 'searching'
          ? previous.groups
          : [],
    });
    run(value);
  }

  return {
    term,
    setTerm,
    isOpen,
    results,
    /** Open the search and focus its input, remembering where focus was. */
    open() {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== input)
        returnFocus = active;
      setOpen(true);
      input?.focus();
      input?.select();
    },
    /** Close the search; `restoreFocus` returns focus to where it was opened from. */
    close(restoreFocus: boolean) {
      setOpen(false);
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
      returnFocus = undefined;
    },
    /** The input registers itself so opening can focus it. */
    setInput(element: HTMLInputElement) {
      input = element;
    },
  };
}

export type DatabaseSearch = ReturnType<typeof createDatabaseSearch>;
