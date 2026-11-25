import { createRoot, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createEmailSearchSuggestions,
  type EmailSearchSuggestions,
  emailSearchNameBeingTyped,
} from './create-email-search-suggestions';
import { emailSearchCompletionText } from './email-search-operators';

beforeEach(() => {
  localStorage.clear();
  // jsdom calls the page unfocused whenever no element has focus, as during
  // a blur; a browser does only while another window or app has the focus.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

const recentListed = (suggestions: EmailSearchSuggestions) =>
  suggestions.listed().map((row) =>
    match(row)
      .with({ kind: 'recent' }, ({ search }) => search)
      .with(
        { kind: 'view' },
        ({ scope, exclude }) => `view:${exclude ? '-' : ''}${scope}`
      )
      .with(
        { kind: 'operator' },
        { kind: 'value' },
        { kind: 'person' },
        { kind: 'label' },
        { kind: 'word' },
        (completion) => emailSearchCompletionText(completion)
      )
      .exhaustive()
  );

const PEOPLE = [
  { id: 'u1', email: 'ana@example.com', name: 'Ana Lopez' },
  { id: 'u2', email: 'bo@example.com' },
];

const LABELS = [
  { name: 'Travel', kind: 'label' as const },
  { name: 'Team offsite', kind: 'tag' as const },
  { name: 'Sent', kind: 'label' as const },
  { name: 'Archive', kind: 'label' as const },
  { name: 'Arch review', kind: 'tag' as const },
];

function setup(initialSearch = '') {
  const [search, setSearch] = createSignal(initialSearch);
  const [hasResults, setHasResults] = createSignal(true);
  const [openedThread, setOpenedThread] = createSignal<{ id: string }>();
  // Threads kept on screen from the search before, not among its results.
  const keptRows = ['kept-thread'];
  const suggestions = createEmailSearchSuggestions({
    userId: () => 'user-a',
    search,
    setSearch,
    hasResults,
    openedThread,
    isResult: (thread) => !keptRows.includes(thread),
    scopeAvailable: (scope) => scope !== 'focus',
    people: () => PEOPLE,
    labels: () => LABELS,
  });
  /** The list opens a thread. */
  const openThread = (id: string) => setOpenedThread({ id });
  return { search, setSearch, setHasResults, openThread, suggestions };
}

/**
 * The recent searches the empty field lists. Leaving the field saves its
 * search a microtask later, so this waits a microtask first.
 */
async function remembered(
  setSearch: (search: string) => void,
  suggestions: EmailSearchSuggestions
) {
  await Promise.resolve();
  setSearch('');
  suggestions.setFocused(true);
  return recentListed(suggestions);
}

it('remembers a search once the field is left with it', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();

    suggestions.setFocused(true);
    setSearch('bud');
    setSearch('budget');
    suggestions.setFocused(false);
    await Promise.resolve();

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['budget']);
    dispose();
  });
});

it('remembers a search left with its results on screen, not one left before they arrive', () => {
  return createRoot(async (dispose) => {
    const { setSearch, setHasResults, suggestions } = setup();
    setHasResults(false);
    suggestions.setFocused(true);
    setSearch('budg');
    suggestions.setFocused(false);
    expect(await remembered(setSearch, suggestions)).toEqual([]);

    setSearch('budget');
    setHasResults(true);
    suggestions.setFocused(false);
    expect(await remembered(setSearch, suggestions)).toEqual(['budget']);
    dispose();
  });
});

it('remembers nothing when a field without the focus goes away', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup('budget');
    suggestions.setFocused(false);

    expect(await remembered(setSearch, suggestions)).toEqual([]);
    dispose();
  });
});

// The field also says it was left as it unmounts, while the view whose list
// holds the results is torn down; reading the list then fails the
// navigation that is leaving the view.
it('reads the list for results only once leaving the field is over, and remembers what the field held', () => {
  return createRoot(async (dispose) => {
    const [search, setSearch] = createSignal('');
    const hasResults = vi.fn(() => true);
    const suggestions = createEmailSearchSuggestions({
      userId: () => 'user-a',
      search,
      setSearch,
      hasResults,
      openedThread: () => undefined,
      isResult: () => true,
      scopeAvailable: () => true,
    });
    suggestions.setFocused(false);
    suggestions.setFocused(true);
    setSearch('budget');
    suggestions.setFocused(false);
    setSearch('budget plans');
    expect(hasResults).not.toHaveBeenCalled();

    expect(await remembered(setSearch, suggestions)).toEqual(['budget']);
    expect(hasResults).toHaveBeenCalledTimes(1);
    dispose();
  });
});

it('does not remember a search when another window takes the focus from the page', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('budg');
    vi.mocked(document.hasFocus).mockReturnValue(false);
    suggestions.setFocused(false);

    vi.mocked(document.hasFocus).mockReturnValue(true);
    expect(await remembered(setSearch, suggestions)).toEqual([]);
    dispose();
  });
});

it('remembers a search on Enter, before its results arrive', () => {
  return createRoot(async (dispose) => {
    const { setSearch, setHasResults, suggestions } = setup();
    setHasResults(false);
    suggestions.setFocused(true);
    setSearch('budget before:2026/1');
    suggestions.commit();

    expect(await remembered(setSearch, suggestions)).toEqual(['budget']);
    dispose();
  });
});

it('leaves a word on its way to an operator unremembered, unless Enter runs it', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();
    for (const typed of ['bef', 'befo', 'invoice ne', '-sub']) {
      suggestions.setFocused(true);
      setSearch(typed);
      suggestions.setFocused(false);
    }
    expect(await remembered(setSearch, suggestions)).toEqual([]);

    // A space after the word, or Enter, says it is the word searched for.
    setSearch('invoice new ');
    suggestions.setFocused(false);
    await Promise.resolve();
    suggestions.setFocused(true);
    setSearch('new');
    suggestions.commit();
    expect(await remembered(setSearch, suggestions)).toEqual([
      'new',
      'invoice new',
    ]);
    dispose();
  });
});

it('remembers a search when the list opens a thread from it, the field still focused', async () => {
  // Mounted first, as the view is, so its effects run before the person acts.
  const { dispose, setSearch, setHasResults, openThread, suggestions } =
    createRoot((dispose) => ({ dispose, ...setup() }));
  setHasResults(false);
  suggestions.setFocused(true);
  // A word the field offers to finish as an operator still counts here.
  setSearch('flights la');
  openThread('thread-1');
  suggestions.setFocused(false);
  expect(await remembered(setSearch, suggestions)).toEqual(['flights la']);

  // The same thread opened again from another search counts again.
  setSearch('lisbon');
  openThread('thread-1');
  expect(await remembered(setSearch, suggestions)).toEqual([
    'lisbon',
    'flights la',
  ]);
  dispose();
});

it('does not remember a search for a thread it did not find', async () => {
  const { dispose, setSearch, setHasResults, openThread, suggestions } =
    createRoot((dispose) => ({ dispose, ...setup() }));
  setHasResults(false);
  suggestions.setFocused(true);
  // A row kept on screen from the search before, while this one loads.
  setSearch('bef');
  openThread('kept-thread');
  suggestions.setFocused(false);

  expect(await remembered(setSearch, suggestions)).toEqual([]);
  dispose();
});

it('puts a picked recent search first', () => {
  localStorage.setItem(
    'macro:email:recent-searches:v1:user-a',
    JSON.stringify(['budget', 'invoice'])
  );
  return createRoot(async (dispose) => {
    const { search, setSearch, setHasResults, suggestions } = setup();
    setHasResults(false);
    suggestions.setFocused(true);
    suggestions.pick(1);
    expect(search()).toBe('invoice');
    suggestions.setFocused(false);

    expect(await remembered(setSearch, suggestions)).toEqual([
      'invoice',
      'budget',
    ]);
    dispose();
  });
});

it('offers the filter a plain word stands for, and picking it replaces the words', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice attachment');
    expect(recentListed(suggestions)).toEqual(['has:attachment ']);
    // Enter still searches the word: no row is picked out until an arrow is.
    expect(suggestions.active()).toBe(-1);
    expect(suggestions.editsQuery?.(0)).toBe(true);
    suggestions.pick(0);
    expect(search()).toBe('invoice has:attachment ');

    setSearch('budget this week');
    expect(recentListed(suggestions)[0]).toBe('newer_than:7d ');
    suggestions.pick(0);
    expect(search()).toBe('budget newer_than:7d ');

    // A view alone would search nothing, so `sent` needs other words.
    setSearch('sent');
    expect(recentListed(suggestions)).toEqual([]);
    setSearch('invoice sent');
    expect(recentListed(suggestions)).toEqual(['in:sent ']);
    dispose();
  });
});

it('offers mail from and to someone a plain word names', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('budget ana');
    expect(recentListed(suggestions)).toEqual([
      'from:ana@example.com ',
      'to:ana@example.com ',
    ]);
    suggestions.pick(1);
    expect(search()).toBe('budget to:ana@example.com ');

    // Someone known only by address, or a word starting none of a name.
    for (const typed of ['budget bo', 'budget xyz']) {
      setSearch(typed);
      expect(recentListed(suggestions)).toEqual([]);
    }
    dispose();
  });
});

it('matches the people found by name without accents or apostrophe spelling', () => {
  createRoot((dispose) => {
    const [search, setSearch] = createSignal('');
    const suggestions = createEmailSearchSuggestions({
      userId: () => 'user-a',
      search,
      setSearch,
      hasResults: () => true,
      openedThread: () => undefined,
      isResult: () => true,
      scopeAvailable: () => true,
      people: () => [
        { id: 'u3', email: 'jose@example.com', name: 'José Ruiz' },
        { id: 'u4', email: 'oneil@example.com', name: "Ana O'Neil" },
      ],
    });
    suggestions.setFocused(true);
    setSearch('jose');
    expect(recentListed(suggestions)).toEqual([
      'from:jose@example.com ',
      'to:jose@example.com ',
    ]);
    setSearch('o’neil');
    expect(recentListed(suggestions)).toEqual([
      'from:oneil@example.com ',
      'to:oneil@example.com ',
    ]);
    dispose();
  });
});

it('reads a plain word of three letters or more as a name being typed', () => {
  expect(emailSearchNameBeingTyped('budget ana')).toBe('ana');
  expect(emailSearchNameBeingTyped("o'neil")).toBe("o'neil");
  // An accent typed as a combining mark is still a name.
  expect(emailSearchNameBeingTyped('Jose\u0301')).toBe('Jose\u0301');
  expect(emailSearchNameBeingTyped('o’neil')).toBe('o’neil');
  for (const text of ['an', 'ana ', 'from:ana', '-ana', '"ana', 'q3x']) {
    expect(emailSearchNameBeingTyped(text)).toBeUndefined();
  }
});

it('lists recent searches only while the field has focus', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup('invoice');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    await Promise.resolve();
    setSearch('');

    expect(recentListed(suggestions)).toEqual([]);
    expect(suggestions.count()).toBe(0);

    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice']);
    dispose();
  });
});

it('runs the picked search, and forgets the active row when typing changes the rows', () => {
  return createRoot(async (dispose) => {
    const { search, setSearch, suggestions } = setup('quarterly budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    await Promise.resolve();
    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['budget', 'quarterly budget']);

    suggestions.setActive(1);
    expect(suggestions.active()).toBe(1);
    setSearch('q');
    // Typing changed the rows, so no row stays picked out.
    expect(recentListed(suggestions)).toEqual(['quarterly budget']);
    expect(suggestions.active()).toBe(-1);
    expect(suggestions.activeId?.()).toBeUndefined();

    suggestions.pick(0);
    expect(search()).toBe('quarterly budget');
    dispose();
  });
});

it('waits for a picked search until its results are taken or the field is used again', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    await Promise.resolve();
    setSearch('');
    suggestions.setFocused(true);

    suggestions.pick(0);
    suggestions.setFocused(false);
    expect(suggestions.awaitsPickedResults()).toBe(true);
    suggestions.pickedResultsTaken();
    expect(suggestions.awaitsPickedResults()).toBe(false);

    setSearch('');
    suggestions.setFocused(true);
    suggestions.pick(0);
    suggestions.setFocused(false);
    suggestions.setFocused(true);
    expect(suggestions.awaitsPickedResults()).toBe(false);
    dispose();
  });
});

it('lists the views an in: being typed can name, leaving out ones the person lacks', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice in:');
    expect(recentListed(suggestions)).toEqual([
      'view:inbox',
      'view:signal',
      'view:noise',
      'view:favorites',
      'view:sent',
      'view:drafts',
      'view:calendar',
      'view:shared',
      'view:archived',
    ]);
    setSearch('invoice in:s');
    expect(recentListed(suggestions)).toEqual([
      'view:signal',
      'view:sent',
      'view:shared',
    ]);

    // Picking one finishes the in: where it was typed and keeps the words.
    expect(suggestions.editsQuery?.(1)).toBe(true);
    suggestions.pick(1);
    expect(search()).toBe('invoice in:sent ');
    expect(suggestions.awaitsPickedResults()).toBe(false);
    dispose();
  });
});

it('remembers a search as it ran, leaving out an in: still being typed', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('invoice in:s');
    suggestions.setFocused(false);
    await Promise.resolve();

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice']);
    dispose();
  });
});

it('remembers a search with its in: filter, and never the filter alone', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('in:sent ');
    suggestions.setFocused(false);

    suggestions.setFocused(true);
    setSearch('in:sent invoice');
    suggestions.setFocused(false);
    await Promise.resolve();

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['in:sent invoice']);
    dispose();
  });
});

it('offers the operators a typed word starts, above recent searches, and finishes one in place', () => {
  return createRoot(async (dispose) => {
    const { search, setSearch, suggestions } = setup('budget subject:lunch');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    await Promise.resolve();
    setSearch('');
    suggestions.setFocused(true);

    setSearch('budget su');
    expect(recentListed(suggestions)).toEqual([
      'subject:',
      'budget subject:lunch',
    ]);

    expect(suggestions.editsQuery?.(0)).toBe(true);
    suggestions.pick(0);
    expect(search()).toBe('budget subject:');
    expect(suggestions.awaitsPickedResults()).toBe(false);
    dispose();
  });
});

it('offers the values of is: and keeps a minus typed before it', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice -is:un');
    expect(recentListed(suggestions)).toEqual(['-is:unread ']);
    suggestions.pick(0);
    expect(search()).toBe('invoice -is:unread ');
    dispose();
  });
});

it('remembers a search without an operator still being typed', () => {
  return createRoot(async (dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('invoice from:ana is:');
    suggestions.setFocused(false);
    await Promise.resolve();

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice from:ana']);
    dispose();
  });
});

it('lists the views -in: can leave out, and finishes one with its minus', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice -in:');
    expect(recentListed(suggestions)).toEqual([
      'view:-inbox',
      'view:-favorites',
      'view:-sent',
      'view:-drafts',
      'view:-calendar',
      'view:-shared',
      'view:-archived',
    ]);
    setSearch('invoice -in:s');
    expect(recentListed(suggestions)).toEqual(['view:-sent', 'view:-shared']);
    suggestions.pick(0);
    expect(search()).toBe('invoice -in:sent ');
    dispose();
  });
});

it('forgets the active row when an edit brings the same text back', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('is:');
    suggestions.setActive(0);
    expect(suggestions.active()).toBe(0);
    setSearch('is:u');
    setSearch('is:');
    expect(suggestions.active()).toBe(-1);
    dispose();
  });
});

it('lists no views for an in: inside a quoted phrase', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('subject:"team -in:se');
    expect(recentListed(suggestions)).toEqual([]);
    setSearch('subject:"team lunch" -in:se');
    expect(recentListed(suggestions)).toEqual(['view:-sent']);
    dispose();
  });
});

it('lists people after from: and finishes the filter with an address', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice -from:a');
    expect(recentListed(suggestions)).toEqual([
      '-from:ana@example.com ',
      '-from:bo@example.com ',
    ]);
    expect(suggestions.editsQuery?.(0)).toBe(true);
    suggestions.pick(0);
    expect(search()).toBe('invoice -from:ana@example.com ');
    dispose();
  });
});

it('lists labels and tags after label:, and after the views once in: names one', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('label:t');
    expect(recentListed(suggestions)).toEqual([
      'label:"Team offsite" ',
      'label:Travel ',
    ]);
    suggestions.pick(0);
    expect(search()).toBe('label:"Team offsite" ');

    setSearch('invoice in:');
    expect(recentListed(suggestions)).not.toContain('in:Travel ');
    setSearch('invoice in:s');
    // Sent is a view, so a label named Sent is not offered as one.
    expect(recentListed(suggestions)).toEqual([
      'view:signal',
      'view:sent',
      'view:shared',
    ]);
    setSearch('invoice in:tr');
    expect(recentListed(suggestions)).toEqual(['in:Travel ']);
    dispose();
  });
});

it('leaves out after in: the labels that read as a view, which label: still offers', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    // `in:Archive` would read as the Archived view still being typed.
    setSearch('in:arch');
    expect(recentListed(suggestions)).toEqual([
      'view:archived',
      'in:"Arch review" ',
    ]);
    setSearch('-in:tr');
    expect(recentListed(suggestions)).toEqual(['-in:Travel ']);
    suggestions.pick(0);
    expect(search()).toBe('-in:Travel ');

    setSearch('label:arch');
    expect(recentListed(suggestions)).toEqual([
      'label:"Arch review" ',
      'label:Archive ',
    ]);
    dispose();
  });
});

it('keeps the row the keyboard picked out as people arrive around it', () => {
  createRoot((dispose) => {
    const [search, setSearch] = createSignal('');
    const [people, setPeople] = createSignal(PEOPLE.slice(1));
    const suggestions = createEmailSearchSuggestions({
      userId: () => 'user-a',
      search,
      setSearch,
      hasResults: () => true,
      openedThread: () => undefined,
      isResult: () => true,
      scopeAvailable: () => true,
      people,
    });
    suggestions.setFocused(true);
    setSearch('from:');
    suggestions.setActive(0);
    expect(recentListed(suggestions)[suggestions.active()]).toBe(
      'from:bo@example.com '
    );

    setPeople(PEOPLE);
    expect(suggestions.active()).toBe(1);
    suggestions.pick(suggestions.active());
    expect(search()).toBe('from:bo@example.com ');

    setSearch('from:');
    suggestions.setActive(0);
    setPeople([]);
    expect(suggestions.active()).toBe(-1);
    dispose();
  });
});
