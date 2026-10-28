import type {
  EditOp,
  FindMatch,
  FindOptions,
  FindResult,
  Pos,
} from '@core/docx-engine/types';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

export type DocxFindDeps = {
  /** Searches the document. */
  search: (query: string, options: FindOptions) => Promise<FindResult>;
  /** The selected text, to search for when the bar opens. */
  selectedText: () => Promise<string>;
  /** Bumps whenever the document's content changes. */
  revision: Accessor<number>;
  /** Runs edit operations in the document. */
  run: (ops: EditOp[]) => void;
  /** Scrolls a match into view. */
  reveal: (match: FindMatch) => void;
};

const samePlace = (a: Pos, b: Pos) =>
  a.block === b.block && a.offset === b.offset;

/**
 * Find and replace for a DOCX editor: the query and options, the matches
 * the engine found (searched again whenever the document changes) and the
 * current one. Moving between matches selects them in the document, so
 * the editor's selection is where a replace happens and where editing
 * continues once the bar closes.
 */
export function createDocxFind(deps: DocxFindDeps) {
  const [open, setOpen] = createSignal(false);
  const [replacing, setReplacing] = createSignal(false);
  const [query, setQuerySignal] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [matchCase, setMatchCase] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [result, setResult] = createSignal<FindResult>({ matches: [] });
  const [current, setCurrent] = createSignal<number>();
  /** What the last replace all did, until the query changes. */
  const [replaced, setReplaced] = createSignal<number>();
  /** Bumps to ask the bar to focus (and select) its search field. */
  const [focusRequest, setFocusRequest] = createSignal(0);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  /** The next result takes its current match from the selection. */
  let followSelection = false;
  onCleanup(() => clearTimeout(timer));

  const options = (): FindOptions => ({
    matchCase: matchCase(),
    wholeWord: wholeWord(),
  });

  const matches = () => result().matches;
  const currentMatch = () => {
    const index = current();
    return index === undefined ? undefined : matches()[index];
  };

  /** Searches after `delay` ms; `reveal` scrolls to the current match. */
  function search(delay: number, reveal: boolean) {
    clearTimeout(timer);
    const mine = ++token;
    if (!open() || !query()) {
      batch(() => {
        setResult({ matches: [] });
        setCurrent(undefined);
      });
      return;
    }
    timer = setTimeout(() => {
      const previous = currentMatch();
      deps
        .search(query(), options())
        .then((next) => {
          if (mine !== token) return;
          // Stay on the match being looked at while the document changes,
          // unless a replace moved the selection on.
          const kept =
            previous && !followSelection
              ? next.matches.findIndex((m) => samePlace(m.from, previous.from))
              : -1;
          followSelection = false;
          const index = kept >= 0 ? kept : next.current;
          batch(() => {
            setResult(next);
            setCurrent(index);
          });
          const match = index === undefined ? undefined : next.matches[index];
          if (reveal && match) deps.reveal(match);
        })
        .catch(() => {});
    }, delay);
  }

  // The engine holds the text: search it again after every change, from
  // this editor or from others.
  createEffect(
    on(
      deps.revision,
      () => {
        if (open() && query()) search(200, false);
      },
      { defer: true }
    )
  );

  /** Moves to a match and selects it in the document. */
  function go(index: number) {
    const match = matches()[index];
    if (!match) return;
    setCurrent(index);
    deps.run([{ op: 'select', anchor: match.from, focus: match.to }]);
    deps.reveal(match);
  }

  return {
    open,
    replacing,
    query,
    replacement,
    matchCase,
    wholeWord,
    matches,
    current,
    currentMatch,
    truncated: () => !!result().truncated,
    replaced,
    focusRequest,
    /** Opens the bar (with the replace field), searching for the selected
     * text when it is a short single line. */
    show(withReplace: boolean) {
      const wasOpen = open();
      batch(() => {
        setOpen(true);
        if (withReplace) setReplacing(true);
        setFocusRequest((n) => n + 1);
      });
      deps
        .selectedText()
        .then((text) => {
          if (text && text.length <= 200 && !/[\n\r]/.test(text)) {
            setReplaced(undefined);
            setQuerySignal(text);
            search(0, true);
          } else if (!wasOpen) search(0, true);
        })
        .catch(() => {});
    },
    /** Closes the bar; the current match stays selected. */
    close() {
      clearTimeout(timer);
      token++;
      batch(() => {
        setOpen(false);
        setReplacing(false);
        setResult({ matches: [] });
        setCurrent(undefined);
        setReplaced(undefined);
      });
    },
    setReplacing,
    setQuery(next: string) {
      setReplaced(undefined);
      setQuerySignal(next);
      search(120, true);
    },
    setReplacement,
    toggleMatchCase() {
      setMatchCase((v) => !v);
      search(0, true);
    },
    toggleWholeWord() {
      setWholeWord((v) => !v);
      search(0, true);
    },
    next() {
      const n = matches().length;
      if (!n) return;
      const index = current();
      go(index === undefined ? 0 : (index + 1) % n);
    },
    previous() {
      const n = matches().length;
      if (!n) return;
      const index = current();
      go(index === undefined ? n - 1 : (index - 1 + n) % n);
    },
    /** Replaces the current match and moves to the next one. */
    replace(editable: boolean) {
      const match = currentMatch();
      if (!editable || !match) return;
      followSelection = true;
      deps.run([
        { op: 'select', anchor: match.from, focus: match.to },
        {
          op: 'replace',
          query: query(),
          options: options(),
          with: replacement(),
        },
      ]);
    },
    /** Replaces every match. */
    replaceAll(editable: boolean) {
      const count = matches().length;
      if (!editable || !count) return;
      followSelection = true;
      setReplaced(count);
      deps.run([
        {
          op: 'replace',
          query: query(),
          options: options(),
          with: replacement(),
          all: true,
        },
      ]);
    },
  };
}

export type DocxFind = ReturnType<typeof createDocxFind>;
