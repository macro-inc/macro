import type { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import type { EntityItem, UserItem } from '@core/context/quickAccess';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  type ComponentProps,
  createResource,
  createSignal,
  Show,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseMentionPickerProps } from './component/GridCell';
import {
  databaseMentionFromItem,
  databaseMentionScope,
} from './core/native-mentions';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
} from './database-mentions';

const nativeMenu = vi.hoisted(() =>
  vi.fn<(props: ComponentProps<typeof MentionsMenu>) => void>()
);
const displayHook = vi.hoisted(() => vi.fn());
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils',
  () => ({ getBlockNameFromEntity: () => 'md' })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu',
  () => ({
    MentionsMenu: (props: ComponentProps<typeof MentionsMenu>) => {
      nativeMenu(props);
      return <div data-testid="native-mentions" />;
    },
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <span>{props.markdown}</span>
    ),
  })
);
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
const ada: UserItem = {
  kind: 'user',
  bucket: 'person',
  id: 'search-index-ada',
  data: { id: 'macro|ada@example.com', name: 'Ada', email: 'ada@example.com' },
  searchText: 'Ada',
  sortTimestamp: 0,
  timestamps: {},
};
const task: EntityItem = {
  kind: 'entity',
  bucket: 'task',
  id: 'search-index-task',
  data: {
    type: 'document',
    id: 'task-id',
    name: 'Ship it',
    ownerId: 'owner',
    fileType: 'md',
    subType: { type: 'task' },
  },
  searchText: 'Ship it',
  sortTimestamp: 0,
  timestamps: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  displayHook.mockReturnValue({ name: () => 'Ada', icon: () => <span /> });
});
afterEach(cleanup);

function setup(overrides: Partial<DatabaseMentionPickerProps> = {}) {
  const select = vi.fn();
  const close = vi.fn();
  const searchChange = vi.fn();
  render(() => {
    const [anchor, setAnchor] = createSignal<HTMLButtonElement>();
    return (
      <>
        <button ref={setAnchor} type="button">
          Current cell
        </button>
        <Show when={anchor()}>
          {(element) => (
            <DatabaseMentionPicker
              anchor={element()}
              value={null}
              search="Ada"
              onSelect={select}
              onClose={close}
              onSearchChange={searchChange}
              {...overrides}
            />
          )}
        </Show>
      </>
    );
  });
  const menu = nativeMenu.mock.calls.at(-1)?.[0];
  if (!menu) throw new Error('Native mention menu was not rendered');
  return { select, close, searchChange, menu };
}

describe('native database mention adapter', () => {
  it('uses canonical data IDs for users and tasks, not search index IDs', () => {
    expect(databaseMentionFromItem(ada)).toEqual({
      id: 'macro|ada@example.com',
      entityType: 'USER',
      label: 'Ada',
    });
    expect(databaseMentionFromItem(task)).toEqual({
      id: 'task-id',
      entityType: 'TASK',
      label: 'Ship it',
    });
  });

  it('restricts People at the native source and excludes groups and unrelated open tabs', () => {
    const { menu, select } = setup({ specificEntityType: 'USER' });
    expect(menu.sources).toEqual(['users']);
    expect(menu.includeGroups).toBe(false);
    expect(menu.showOpenTabs).toBe(false);
    expect(menu.anchor).toBe(
      screen.getByRole('button', { name: 'Current cell' })
    );
    menu.onPick?.(task);
    expect(select).not.toHaveBeenCalled();
    menu.onPick?.(ada);
    expect(select).toHaveBeenCalledExactlyOnceWith({
      id: 'macro|ada@example.com',
      entityType: 'USER',
      label: 'Ada',
    });
  });

  it('restricts Tasks at the document query source, not merely after selecting an item', () => {
    const { menu, select } = setup({ specificEntityType: 'TASK' });
    expect(menu.sources).toEqual(['documents']);
    expect(menu.documentBuckets).toEqual(['task']);
    menu.onPick?.(ada);
    expect(select).not.toHaveBeenCalled();
    menu.onPick?.(task);
    expect(select).toHaveBeenCalledExactlyOnceWith({
      id: 'task-id',
      entityType: 'TASK',
      label: 'Ship it',
    });
    expect(databaseMentionScope('DOCUMENT')).toEqual({
      sources: ['documents'],
      documentBuckets: ['note', 'snippet', 'document'],
    });
    expect(databaseMentionScope('CALENDAR_EVENT').sources).toEqual([]);
  });

  it('delegates native search and dismissal back to the cell', () => {
    const { menu, searchChange, close } = setup();
    expect(menu.menu.searchTerm()).toBe('Ada');
    menu.menu.setSearchTerm('Ada Lovelace');
    expect(searchChange).toHaveBeenCalledExactlyOnceWith('Ada Lovelace');
    menu.menu.setIsOpen(false);
    expect(close).toHaveBeenCalledTimes(1);
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
