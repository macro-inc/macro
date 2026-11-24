import { createRoot, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { beforeEach, expect, it } from 'vitest';
import {
  createEmailSearchSuggestions,
  type EmailSearchSuggestions,
} from './create-email-search-suggestions';
import { emailSearchCompletionText } from './email-search-operators';

beforeEach(() => localStorage.clear());

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
  const suggestions = createEmailSearchSuggestions({
    userId: () => 'user-a',
    search,
    setSearch,
    scopeAvailable: (scope) => scope !== 'focus',
    people: () => PEOPLE,
    labels: () => LABELS,
  });
  return { search, setSearch, suggestions };
}

it('remembers a search once the field is left with it', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();

    suggestions.setFocused(true);
    setSearch('bud');
    setSearch('budget');
    suggestions.setFocused(false);

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['budget']);
    dispose();
  });
});

it('lists recent searches only while the field has focus', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup('invoice');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('');

    expect(recentListed(suggestions)).toEqual([]);
    expect(suggestions.count()).toBe(0);

    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice']);
    dispose();
  });
});

it('runs the picked search, and forgets the active row when typing changes the rows', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup('quarterly budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
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
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
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
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('invoice in:s');
    suggestions.setFocused(false);

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice']);
    dispose();
  });
});

it('remembers a search with its in: filter, and never the filter alone', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('in:sent ');
    suggestions.setFocused(false);

    suggestions.setFocused(true);
    setSearch('in:sent invoice');
    suggestions.setFocused(false);

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['in:sent invoice']);
    dispose();
  });
});

it('offers the operators a typed word starts, above recent searches, and finishes one in place', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup('budget subject:lunch');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
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
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('invoice from:ana is:');
    suggestions.setFocused(false);

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
