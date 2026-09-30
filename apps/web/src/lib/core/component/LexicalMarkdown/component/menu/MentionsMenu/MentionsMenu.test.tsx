import type { IUser } from '@core/user';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../../shared/inlineMenu';
import { MentionsMenu } from './MentionsMenu';

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock('@core/block', () => ({
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCrm: {},
  isFeatureEnabled: () => false,
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({ useList: () => ({ items: () => [] }) }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'gab@macro.com',
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/util/dateSearch/useDateSearch', () => ({
  useDateSearch: () => () => [],
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('../../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
}));
vi.mock('../../../directive/floatWithElement', () => ({
  floatWithElement: vi.fn(),
}));
vi.mock('../../../plugins', () => ({ CLOSE_INLINE_SEARCH_COMMAND: {} }));
vi.mock('./utils/mentionHandlers', () => ({ createItemHandler: vi.fn() }));
vi.mock('./hooks/useEmailSearchMention', () => ({
  useEmailSearchMention: vi.fn(),
}));
vi.mock('./hooks/useProjectMention', () => ({
  useProjectMention: () => ({
    projects: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@ui', () => ({
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  cn: (...classes: unknown[]) =>
    classes.filter((c) => typeof c === 'string').join(' '),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

it('keeps matching category and row nodes mounted across typing and updated people', async () => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  const seamus: IUser = {
    id: 'macro|seamus@macro.com',
    name: 'Seamus Edson',
    email: 'seamus@macro.com',
  };
  const [users, setUsers] = createSignal([seamus]);
  const menu = createMenuOperations();
  menu.setSearchTerm('sea');
  menu.openMenu();
  const onPick = vi.fn();
  render(() => (
    <MentionsMenu
      menu={menu}
      entities={() => []}
      users={users}
      sources={['users']}
      anchor={document.createElement('div')}
      onPick={onPick}
    />
  ));
  const heading = screen.getByText('People');
  const row = screen.getByTitle('Seamus Edson seamus@macro.com');
  for (const term of ['seam', 'seamu', 'seam', 'sea']) {
    menu.setSearchTerm(term);
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByText('People')).toBe(heading);
    expect(screen.getByTitle('Seamus Edson seamus@macro.com')).toBe(row);
  }
  const updated = { ...seamus, name: 'Seamus Updated' };
  setUsers([updated]);
  expect(screen.getByText('People')).toBe(heading);
  expect(screen.getByTitle('Seamus Updated seamus@macro.com')).toBe(row);
  fireEvent.click(row);
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ data: updated })
  );
  expect(menu.isOpen()).toBe(false);
});
