import { analytics } from '@app/lib/analytics';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../../routines/core/draft';
import { type SuggestionItem, suggestionItem } from '../core/suggestions';
import { createSuggestionActions } from '../primitives/suggestion-actions';
import { context, drafted, forYou, TAGS, template } from '../tests/fixtures';
import {
  SuggestionDialogGrid,
  SuggestionRow,
  suggestionListView,
} from './suggestion-list-view';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const items = [forYou, template, drafted].flatMap(
  (suggestion): SuggestionItem[] => {
    const result = suggestionItem(suggestion, [TAGS], context(true));
    return result ? [result] : [];
  }
);

function renderCards() {
  const created: ScheduleDraft[] = [];
  const customize = vi.fn();
  const [listed, setListed] = createSignal(items);
  // The server's answer drops a dismissed suggestion, as the query cache does.
  const dismiss = vi.fn(async (item: SuggestionItem) => {
    setListed((current) => current.filter((kept) => kept.id !== item.id));
  });
  const onOpenRoutine = vi.fn();
  render(() => {
    const actions = createSuggestionActions({
      placement: () => ({ kind: 'sidebar', surface: 'email' }),
      create: async (draft) => {
        created.push(draft);
        return 'routine-1';
      },
      customize,
      dismiss,
      notify: vi.fn(),
    });
    return (
      <SuggestionDialogGrid
        view={suggestionListView({
          suggestions: actions.visible(listed()),
          generating: false,
          failed: false,
        })}
        actions={actions}
        surface="email"
        emptyLabel="None"
        onRetry={vi.fn()}
        onOpenRoutine={onOpenRoutine}
      />
    );
  });
  return { created, customize, dismiss, onOpenRoutine };
}

describe('suggestion cards', () => {
  it('say who suggests each one, and why AI picked it', () => {
    renderCards();
    const [pick, macro, drafts] = screen.getAllByRole('listitem');
    expect(within(pick!).getByText('For you')).toBeTruthy();
    expect(
      within(pick!).getByText('You answer most mail within a day.')
    ).toBeTruthy();
    expect(within(macro!).getByText('Template')).toBeTruthy();
    expect(within(macro!).getByText('From Macro')).toBeTruthy();
    expect(within(drafts!).getByText('Draft')).toBeTruthy();
    expect(
      within(drafts!).getByText('Suppliers write every week.')
    ).toBeTruthy();
  });

  it('turn on an AI pick in one click with a changed value, then open it', async () => {
    const host = renderCards();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reply tag: Respond. Change it' })
    );
    // A boolean flips in place; other knobs open their editor.
    const field = await screen.findByRole('textbox', { name: 'Reply tag' });
    fireEvent.input(field, { target: { value: 'Answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on Tag new email' })
    );
    await waitFor(() => expect(host.created).toHaveLength(1));
    expect(host.created[0]).toMatchObject({
      suggestionId: 'pick-1',
      description: 'Tag each new email Answer within 14 days.',
    });
    // What was saved no longer changes from the card.
    expect(
      screen.queryByRole('button', { name: 'Reply tag: Answer. Change it' })
    ).toBeNull();
    expect(
      screen.getByText('Tag each new email Answer within 14 days.')
    ).toBeTruthy();
    expect(await screen.findByText('Enabled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enabled' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Tag new email' }));
    expect(host.onOpenRoutine).toHaveBeenCalledWith('routine-1');
  });

  it('open an AI pick in the editor from anywhere on its card, while its values and Turn on stay their own', async () => {
    const host = renderCards();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Tag new email before turning it on',
      })
    );
    expect(host.customize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ suggestionId: 'pick-1' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Reply tag: Respond. Change it' })
    );
    expect(
      await screen.findByRole('textbox', { name: 'Reply tag' })
    ).toBeTruthy();
    expect(host.customize).toHaveBeenCalledOnce();
    expect(host.created).toEqual([]);
  });

  it('send a drafted routine and Macro’s template to the editor, never saving them from the card', () => {
    const host = renderCards();
    fireEvent.click(
      screen.getByRole('button', { name: 'Review Supplier digest' })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Start a routine from Tag new email',
      })
    );
    expect(host.created).toEqual([]);
    expect(host.customize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ suggestionId: 'drafted-1' })
    );
    expect(host.customize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ suggestionId: 'template-1' })
    );
  });

  it('dismiss one, which leaves the open dialog at once', async () => {
    const host = renderCards();
    fireEvent.click(
      screen.getByRole('button', { name: 'Not interested in Supplier digest' })
    );
    expect(host.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'drafted-1' })
    );
    await waitFor(() =>
      expect(screen.queryByText('Supplier digest')).toBeNull()
    );
  });
});

/**
 * Lays the row's grid out with these resolved columns, which jsdom can't
 * compute, and measures it after the cards mount, as a browser does after
 * layout and before the first paint.
 */
function layOutRow(columns: string) {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    if (element.tagName !== 'UL') return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === 'gridTemplateColumns') return columns;
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        const entry = { target, contentRect: { width: 1000, height: 240 } };
        queueMicrotask(() =>
          this.callback(
            [entry as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
}

/** Five suggestions in the row; the ids it counted as shown. */
function renderRow(onOpenDiscover = vi.fn()) {
  vi.mocked(analytics.track).mockClear();
  const many = [
    ...items,
    ...items.slice(0, 2).map((item, n) => ({ ...item, id: `more-${n}` })),
  ];
  render(() => {
    const actions = createSuggestionActions({
      placement: () => ({ kind: 'routines' }),
      create: vi.fn(async () => 'routine-1'),
      customize: vi.fn(),
      dismiss: vi.fn(async () => {}),
      notify: vi.fn(),
    });
    return (
      <SuggestionRow
        items={many}
        actions={actions}
        onOpenDiscover={onOpenDiscover}
        onOpenRoutine={vi.fn()}
      />
    );
  });
  return () =>
    vi
      .mocked(analytics.track)
      .mock.calls.filter(([event]) => event === 'routine_suggestion_shown')
      .map(([, props]) => (props as { suggestionId: string }).suggestionId);
}

describe('the row above the routines list', () => {
  it('shows as many of Discover’s cards as fit, counts each as shown, and says how many more Discover has', async () => {
    layOutRow('400px 400px 400px 400px 128px');
    const onOpenDiscover = vi.fn();
    const shown = renderRow(onOpenDiscover);
    const more = await screen.findByRole('button', {
      name: '1 more in Discover',
    });
    expect(shown()).toEqual(['pick-1', 'template-1', 'drafted-1', 'more-0']);
    // Discover's card: the sentence, not a one-line chain.
    const [pick] = screen.getAllByRole('listitem');
    expect(
      within(pick!).getByRole('button', {
        name: 'Reply tag: Respond. Change it',
      })
    ).toBeTruthy();
    fireEvent.click(more);
    expect(onOpenDiscover).toHaveBeenCalledOnce();
  });

  it('shows one card where the page fits one, never counting a card it dropped as shown', async () => {
    layOutRow('400px 128px');
    const shown = renderRow();
    expect(
      await screen.findByRole('button', { name: '4 more in Discover' })
    ).toBeTruthy();
    expect(shown()).toEqual(['pick-1']);
  });
});
