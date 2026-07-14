import { type Accessor, createEffect, createSignal, on } from 'solid-js';

type FindBarSourceContext = {
  isOpen: Accessor<boolean>;
  submittedQuery: Accessor<string>;
  activeIndex: Accessor<number>;
};

type FindBarSource<T> = {
  results: Accessor<T[]>;
  isFetching: Accessor<boolean>;
  navigate: (result: T) => void;
  validateText?: (text: string) => boolean;
  totalCount?: Accessor<number | undefined>;
  /** When false, `previous()` stops at index 1. Defaults to true. */
  wrapPrevious?: Accessor<boolean>;
  /** When false, `next()` stops at the last result. Defaults to true. */
  wrapNext?: Accessor<boolean>;
};

export type FindBarController = {
  isOpen: Accessor<boolean>;
  query: Accessor<string>;
  setQuery: (value: string) => void;
  submittedQuery: Accessor<string>;
  activeIndex: Accessor<number>;
  hasUnsubmittedChanges: Accessor<boolean>;
  isPending: Accessor<boolean>;
  resultsCount: Accessor<number>;
  canNext: Accessor<boolean>;
  canPrevious: Accessor<boolean>;
  open: () => void;
  close: () => void;
  submit: () => void;
  next: () => void;
  previous: () => void;
  setInputEl: (el: HTMLInputElement | undefined) => void;
};

type FindBarControllerOptions = {
  /**
   * Fires synchronously inside `submit()` *before* `submittedQuery` updates.
   * Lets callers run side-effects (e.g. clearing an existing selection)
   * that must complete before downstream results-driven effects run.
   */
  onBeforeSubmit?: () => void;
};

export function createFindBarController<T>(
  makeSource: (ctx: FindBarSourceContext) => FindBarSource<T>,
  options: FindBarControllerOptions = {}
): FindBarController {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [submittedQuery, setSubmittedQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [inputEl, setInputEl] = createSignal<HTMLInputElement>();

  const source = makeSource({ isOpen, submittedQuery, activeIndex });
  const validateText = source.validateText ?? ((text) => text.length > 0);

  createEffect(
    on(source.results, (rs) => {
      if (!isOpen()) return;
      if (rs.length === 0) {
        setActiveIndex(0);
        return;
      }
      const current = activeIndex();
      const nextIdx =
        current === 0 ? 1 : Math.max(1, Math.min(current, rs.length));
      setActiveIndex(nextIdx);
      source.navigate(rs[nextIdx - 1]);
    })
  );

  const wrapNext = () => source.wrapNext?.() ?? true;
  const wrapPrevious = () => source.wrapPrevious?.() ?? true;

  const next = () => {
    const rs = source.results();
    if (rs.length === 0) return;
    if (activeIndex() >= rs.length && !wrapNext()) return;
    const i = activeIndex() >= rs.length ? 1 : activeIndex() + 1;
    setActiveIndex(i);
    source.navigate(rs[i - 1]);
  };

  const previous = () => {
    const rs = source.results();
    if (rs.length === 0) return;
    if (activeIndex() <= 1 && !wrapPrevious()) return;
    const i = activeIndex() <= 1 ? rs.length : activeIndex() - 1;
    setActiveIndex(i);
    source.navigate(rs[i - 1]);
  };

  const submit = () => {
    const trimmed = query().trim();
    options.onBeforeSubmit?.();
    setSubmittedQuery(validateText(trimmed) ? trimmed : '');
  };

  const open = () => {
    if (!isOpen()) {
      setIsOpen(true);
      return;
    }
    const el = inputEl();
    if (el && document.activeElement === el) {
      setIsOpen(false);
      return;
    }
    el?.focus();
    el?.select();
  };

  const close = () => {
    setIsOpen(false);
    setSubmittedQuery('');
    setActiveIndex(0);
  };

  return {
    isOpen,
    query,
    setQuery: (value) => setQuery(value),
    submittedQuery,
    activeIndex,
    hasUnsubmittedChanges: () => query().trim() !== submittedQuery(),
    isPending: () => !!submittedQuery() && source.isFetching(),
    resultsCount: () => source.totalCount?.() ?? source.results().length,
    canNext: () => {
      const len = source.results().length;
      if (len === 0) return false;
      return wrapNext() || activeIndex() < len;
    },
    canPrevious: () => {
      const len = source.results().length;
      if (len === 0) return false;
      return wrapPrevious() || activeIndex() > 1;
    },
    open,
    close,
    submit,
    next,
    previous,
    setInputEl: (el) => setInputEl(el),
  };
}
