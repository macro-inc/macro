import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../../routines/core/draft';
import { type SuggestionItem, suggestionItem } from '../core/suggestions';
import { createSuggestionActions } from '../primitives/suggestion-actions';
import { context, drafted, forYou, TAGS, template } from '../tests/fixtures';
import { SuggestionRows, suggestionListView } from './suggestion-list-view';

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
    const result = suggestionItem(suggestion, [TAGS], context(false));
    return result ? [result] : [];
  }
);

function renderRows() {
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
      <SuggestionRows
        view={suggestionListView({
          suggestions: actions.visible(listed()),
          generating: false,
          failed: false,
        })}
        actions={actions}
        emptyLabel="None"
        onRetry={vi.fn()}
        onOpenRoutine={onOpenRoutine}
      />
    );
  });
  return { created, customize, dismiss, onOpenRoutine };
}

describe('suggestion rows', () => {
  it('say who suggests each one', () => {
    renderRows();
    expect(
      screen.getByText('For you · You answer most mail within a day.')
    ).toBeTruthy();
    expect(screen.getByText('Template from Macro')).toBeTruthy();
    expect(screen.getByText('For you · Suppliers write every week.')).toBeTruthy();
  });

  it('enable a catalog routine in one click, then open it', async () => {
    const host = renderRows();
    const [enable] = screen.getAllByRole('button', {
      name: 'Enable Tag new email',
    });
    fireEvent.click(enable!);
    await waitFor(() => expect(host.created).toHaveLength(1));
    expect(host.created[0]).toMatchObject({ suggestionId: 'pick-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Enabled' }));
    expect(host.onOpenRoutine).toHaveBeenCalledWith('routine-1');
  });

  it('send a drafted routine to the editor to review, never saving it from the row', () => {
    const host = renderRows();
    fireEvent.click(screen.getByRole('button', { name: 'Review Supplier digest' }));
    expect(host.created).toEqual([]);
    expect(host.customize).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionId: 'drafted-1' })
    );
  });

  it('let the person edit the instructions first, and dismiss one', async () => {
    const host = renderRows();
    const [, templateRow] = screen.getAllByRole('button', {
      name: /Tag new email/,
      expanded: false,
    });
    fireEvent.click(templateRow!);
    const instructions = await screen.findByRole('textbox', {
      name: 'Instructions',
    });
    fireEvent.input(instructions, { target: { value: 'Tag it my way.' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Enable Tag new email' })[1]!
    );
    await waitFor(() =>
      expect(host.created[0]).toMatchObject({
        suggestionId: 'template-1',
        prompt: 'Tag it my way.',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Not interested in Supplier digest' })
    );
    expect(host.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'drafted-1' })
    );
    // It leaves the open list at once.
    await waitFor(() =>
      expect(screen.queryByText('Supplier digest')).toBeNull()
    );
  });
});
