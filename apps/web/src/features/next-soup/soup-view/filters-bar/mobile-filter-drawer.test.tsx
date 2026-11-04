import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileFilterDrawer } from './mobile-filter-drawer';

const fixture = vi.hoisted(() => ({ view: 'tasks' }));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'component', id: fixture.view }) },
  }),
}));
vi.mock('@app/features/next-soup/soup-view/soup-view-context', () => ({
  useSoupView: () => ({
    soup: { sort: { active: () => [] }, predicates: { isActive: () => false } },
    queryFilters: { state: { include: {} } },
    assigneeFilter: () => [],
    activeTab: () => 'all',
    inboxFilter: () => undefined,
    setInboxFilter: vi.fn(),
  }),
}));
vi.mock('./use-filter-refinements', () => ({
  useFilterRefinements: () => ({
    consolidatedFiltersList: () => [],
    resetToTabDefaults: vi.fn(),
    handleAssigneeChange: vi.fn(),
  }),
}));
vi.mock('./use-inbox-picker', () => ({
  useInboxPicker: () => ({
    hasMultiple: () => false,
    options: () => [],
    activeIds: () => [],
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [
    {
      id: 'macro|outside@example.com',
      email: 'outside@example.com',
      name: 'Outside',
    },
  ],
}));
vi.mock('@property/queries/team-members', () => ({
  useTeamMembers: (enabled: () => boolean) => {
    // Query options and the roster memo evaluate enabled during setup.
    const active = enabled();
    return {
      users: () =>
        active
          ? [
              {
                id: 'macro|member@example.com',
                email: 'member@example.com',
                name: 'Member',
              },
            ]
          : [],
      isLoading: () => false,
      isError: () => false,
    };
  },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/email-link', () => ({ useAddInboxFlow: () => vi.fn() }));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({ filters: {} }),
}));
vi.mock('./unified-filter-dropdown', async () => ({
  buildContactLabel: (await import('./assignee-picker')).buildContactLabel,
  VIEW_FILTER_CATEGORIES: {},
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: {
    Label: (props: ParentProps) => <div>{props.children}</div>,
    Section: (props: ParentProps) => <div>{props.children}</div>,
  },
}));
vi.mock('@app/components/view-shell/MobileFilterDrawer', () => ({
  MobileFilterDrawer: Object.assign(
    (props: ParentProps) => <div>{props.children}</div>,
    {
      Section: (props: ParentProps<{ label: string }>) => (
        <section aria-label={props.label}>{props.children}</section>
      ),
      Option: (props: ParentProps<{ onChange: () => void }>) => (
        <button onClick={props.onChange}>{props.children}</button>
      ),
    }
  ),
}));

afterEach(cleanup);

describe('mobile filter initialization', () => {
  it.each(['tasks', 'documents', 'mail'])(
    'initializes synchronous roster dependencies in %s',
    (view) => {
      fixture.view = view;
      render(() => <MobileFilterDrawer />);
      if (view === 'tasks') {
        expect(screen.getByText('Member')).toBeTruthy();
        const assigneeSearch = screen.getByLabelText('Search assignees');
        fireEvent.input(assigneeSearch, { target: { value: 'outside' } });
        expect(
          within(screen.getByRole('region', { name: 'Assignee' })).queryByText(
            'Outside'
          )
        ).toBeNull();
        fireEvent.click(
          screen.getByRole('button', { name: 'Find other people…' })
        );
        expect(
          within(screen.getByRole('region', { name: 'Assignee' })).getByText(
            'Outside'
          )
        ).toBeTruthy();
        expect(screen.getByLabelText('Search assignees')).toBe(assigneeSearch);
      } else {
        expect(
          screen.queryByRole('button', { name: 'Find other people…' })
        ).toBeNull();
      }
    }
  );
});
