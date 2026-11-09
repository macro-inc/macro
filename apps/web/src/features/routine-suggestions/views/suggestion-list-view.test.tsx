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
    fireEvent.click(await screen.findByRole('button', { name: 'Enabled' }));
    expect(host.onOpenRoutine).toHaveBeenCalledWith('routine-1');
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
