import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createResource, createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseMentionPickerProps } from '../component/GridCell';
import type { DatabaseMentionCandidate } from '../core/database-mentions';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
} from '../database-mentions';

const source = vi.hoisted(() => ({
  items: vi.fn<() => DatabaseMentionCandidate[]>(),
  loading: vi.fn(() => false),
  loadingMore: vi.fn(() => false),
  hasMore: vi.fn(() => false),
  loadMore: vi.fn(async () => {}),
}));
const displayHook = vi.hoisted(() => vi.fn());
vi.mock('../queries/database-mentions', () => ({
  useDatabaseMentions: () => source,
}));
vi.mock('@property/hooks/usePropertyEntityDisplay', () => ({
  usePropertyEntityDisplay: displayHook,
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { suppressClick: boolean; showTooltip: boolean }) => (
    <span
      data-testid="person-icon"
      data-suppress-click={props.suppressClick}
      data-tooltip={props.showTooltip}
    />
  ),
}));

const ada: DatabaseMentionCandidate = {
  id: 'ada',
  entityType: 'USER',
  label: 'Ada',
  description: 'ada@example.com',
};
const plan: DatabaseMentionCandidate = {
  id: 'plan',
  entityType: 'DOCUMENT',
  label: 'Project plan',
};
let presenceStyles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  source.items.mockReturnValue([ada, plan]);
  source.loading.mockReturnValue(false);
  source.loadingMore.mockReturnValue(false);
  source.hasMore.mockReturnValue(false);
  source.loadMore.mockResolvedValue();
  displayHook.mockReturnValue({ name: () => 'Ada', icon: () => <span /> });
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  presenceStyles = document.createElement('style');
  presenceStyles.textContent = '[role=dialog] { animation-name: none; }';
  document.head.append(presenceStyles);
});
afterEach(() => {
  cleanup();
  presenceStyles.remove();
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<DatabaseMentionPickerProps> = {}) {
  const select = vi.fn();
  const close = vi.fn();
  const searchChange = vi.fn();
  render(() => {
    const [open, setOpen] = createSignal(true);
    let anchor: HTMLButtonElement | undefined;
    let next: HTMLInputElement | undefined;
    return (
      <>
        <button ref={anchor} type="button">
          Current cell
        </button>
        <input ref={next} aria-label="Next cell" />
        <Show when={open()}>
          <DatabaseMentionPicker
            anchor={anchor}
            value={null}
            search=""
            onSelect={(...args) => {
              select(...args);
              setOpen(false);
              next?.focus();
            }}
            onClose={(restoreFocus = true) => {
              close(restoreFocus);
              setOpen(false);
              if (restoreFocus) anchor?.focus();
            }}
            onSearchChange={searchChange}
            {...overrides}
          />
        </Show>
      </>
    );
  });
  return { select, close, searchChange };
}

describe('database mention picker', () => {
  it('dismisses on outside focus without returning focus to the cell', async () => {
    const { close } = setup();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('combobox'))
    );
    const next = screen.getByRole('textbox', { name: 'Next cell' });
    next.focus();
    await waitFor(() => expect(close).toHaveBeenCalledExactlyOnceWith(false));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('restores focus on Escape from the pagination control', async () => {
    source.hasMore.mockReturnValue(true);
    const { close } = setup();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('combobox'))
    );
    const more = screen.getByRole('button', { name: 'Show more' });
    more.focus();
    fireEvent.keyDown(more, { key: 'Escape' });
    await waitFor(() => expect(close).toHaveBeenCalledExactlyOnceWith(true));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Current cell' })
    );
  });

  it('focuses search and selects the arrow-selected mention with Enter without stealing the next cell focus', async () => {
    const { select } = setup();
    const search = screen.getByRole('combobox', { name: 'Search mentions' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      screen
        .getByRole('option', { name: 'Ada ada@example.com' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(
      screen
        .getByRole('option', { name: 'Project plan Document' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(select).toHaveBeenCalledExactlyOnceWith(plan, undefined);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    );
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Next cell' })
    );
  });

  it.each([
    { shiftKey: false, direction: 1 },
    { shiftKey: true, direction: -1 },
  ])(
    'selects with Tab and delegates direction $direction to the grid',
    async ({ shiftKey, direction }) => {
      const { select } = setup();
      const search = screen.getByRole('combobox');
      await waitFor(() => expect(document.activeElement).toBe(search));
      fireEvent.keyDown(search, { key: 'Tab', shiftKey });
      expect(select).toHaveBeenCalledExactlyOnceWith(
        { id: ada.id, entityType: ada.entityType, label: ada.label },
        direction
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
      );
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Next cell' })
      );
    }
  );

  it('keeps typed search available to the cell and closes once on Escape', async () => {
    const { close, select, searchChange } = setup({ search: 'Ad' });
    const search = screen.getByRole('combobox') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(search.value).toBe('Ad');
    fireEvent.input(search, { target: { value: 'Ada L' } });
    expect(searchChange).toHaveBeenCalledExactlyOnceWith('Ada L');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    );
  });

  it('does not select a stale item when search has no matches', async () => {
    source.items.mockReturnValue([]);
    const { select, close } = setup();
    const search = screen.getByRole('combobox');
    expect(screen.getByRole('status').textContent).toBe('No matches');
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the search focused on pointer selection and strips display-only fields', async () => {
    const { select } = setup();
    const search = screen.getByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(search));
    const option = screen.getByRole('option', { name: 'Ada ada@example.com' });
    expect(fireEvent.mouseDown(option)).toBe(false);
    expect(document.activeElement).toBe(search);
    fireEvent.click(option);
    expect(select).toHaveBeenCalledExactlyOnceWith(
      { id: 'ada', entityType: 'USER', label: 'Ada' },
      undefined
    );
  });

  it('keeps pagination failure inside the picker and allows retry', async () => {
    source.hasMore.mockReturnValue(true);
    source.loadMore.mockRejectedValueOnce(new Error('Unavailable'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not load more. Try again.'
    );
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(source.loadMore).toHaveBeenCalledTimes(2);
  });
});

describe('database mention display', () => {
  it('renders a noninteractive person label inside the existing cell button', () => {
    render(() => (
      <button type="button">
        <DatabaseMentionValue id="ada" entityType="USER" />
      </button>
    ));
    expect(screen.getByRole('button', { name: 'Ada' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
    const icon = screen.getByTestId('person-icon');
    expect(icon.getAttribute('data-suppress-click')).toBe('true');
    expect(icon.getAttribute('data-tooltip')).toBe('false');
  });

  it('keeps the rest of the grid mounted while a mention name loads', async () => {
    let resolve: (name: string) => void = () => {};
    const name = new Promise<string>((done) => {
      resolve = done;
    });
    displayHook.mockImplementation(() => {
      const [result] = createResource(() => name);
      return { name: result, icon: () => <span /> };
    });
    render(() => (
      <div>
        <input aria-label="Unrelated cell" value="keep editing" />
        <DatabaseMentionValue id="plan" entityType="DOCUMENT" />
      </div>
    ));
    const editor = screen.getByRole('textbox', { name: 'Unrelated cell' });
    editor.focus();
    expect(screen.getByText('Document')).toBeTruthy();
    resolve('Project plan');
    await screen.findByText('Project plan');
    expect(screen.getByRole('textbox', { name: 'Unrelated cell' })).toBe(
      editor
    );
    expect(document.activeElement).toBe(editor);
  });
});
