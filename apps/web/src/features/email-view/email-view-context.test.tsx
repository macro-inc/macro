import { cleanup, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EmailViewContext,
  EmailViewProvider,
  useEmailView,
} from './email-view-context';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useRouteParams: vi.fn(),
  useEmailLinksQuery: vi.fn(),
  remindersEnabled: true,
  searchTab: 'important' as 'important' | 'reminders',
}));

vi.mock('@app/components/list', () => ({
  createListController: () => ({}),
  listOwnedSlotName: (name: string) => name,
}));
vi.mock('@app/components/view-shell', () => ({}));
vi.mock(
  '@app/features/soup',
  async () => import('../soup/filters/facets/selection')
);
vi.mock('@app/features/soup/collection/list-navigation-source', () => ({
  registerListNavigationSource: () => {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: mocks.remindersEnabled,
    loading: false,
    payload: undefined,
  }),
}));
vi.mock('@app/lib/persistence', () => ({
  makePersistedState: <T,>(store: T) => store,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouteParams: () => mocks.useRouteParams(),
  createSearchParams: () => [
    {
      get tab() {
        return mocks.searchTab;
      },
    },
  ],
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { id: 'mail-panel' } }),
  withSplitPanelOwner: (_slot: string, create: () => unknown) => create(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => [],
  useTagSetsReady: () => () => true,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => mocks.useEmailLinksQuery(),
}));
vi.mock('./persistence', () => ({ createEmailViewPersistence: () => ({}) }));
vi.mock('./queries/use-email-query', () => ({
  useEmailDataSource: () => ({ items: () => [] }),
}));
vi.mock('./route', () => ({
  emailSplitRoute: { id: 'view-mail' },
  emailThreadRoute: { id: 'mail-thread' },
}));
vi.mock('./email-route', () => ({
  emailTabSearch: { namespace: 'mail' },
  emailDetailSearch: { namespace: 'email-detail' },
  emailTabSearchCodec: { serialize: (value: unknown) => value },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.remindersEnabled = true;
  mocks.searchTab = 'important';
});

function mount(initialState: { tab?: 'reminders' } = {}) {
  const [linksQuery, setLinksQuery] = createStore({
    isSuccess: false,
    data: { links: [] as { id: string }[] },
  });
  const [params, setParams] = createStore<{ threadId?: string }>({
    threadId: 'open-thread',
  });
  mocks.useEmailLinksQuery.mockReturnValue(linksQuery);
  mocks.useRouteParams.mockReturnValue(params);
  mocks.navigate.mockImplementation(
    (target: { params: { threadId?: string } }) =>
      setParams('threadId', target.params.threadId)
  );
  let view!: EmailViewContext;
  function ReadContext() {
    view = useEmailView();
    return null;
  }
  render(() => (
    <EmailViewProvider
      initialState={{ inboxIds: ['saved-inbox'], ...initialState }}
    >
      <ReadContext />
    </EmailViewProvider>
  ));
  return { view, setLinksQuery };
}

describe('email view reminders tab', () => {
  it('lands on a linked Reminders tab while the flag is on', () => {
    mocks.searchTab = 'reminders';
    const { view } = mount({ tab: 'reminders' });
    expect(view.state.tab).toBe('reminders');
  });

  it('falls back to Signal when the flag is off', () => {
    mocks.searchTab = 'reminders';
    mocks.remindersEnabled = false;
    const { view } = mount({ tab: 'reminders' });
    expect(view.state.tab).toBe('important');
  });
});

describe('email view inbox reconciliation', () => {
  it.each([{ links: [] }, { links: [{ id: 'remaining-inbox' }] }])(
    'preserves the thread when loaded accounts invalidate the saved scope: %j',
    ({ links }) => {
      const { view, setLinksQuery } = mount();
      expect(view.state.inboxIds).toEqual(['saved-inbox']);
      expect(view.selectedThread()?.id).toBe('open-thread');

      setLinksQuery({ isSuccess: true, data: { links } });

      expect(view.state.inboxIds).toBeUndefined();
      expect(view.selectedThread()?.id).toBe('open-thread');
      expect(mocks.navigate).not.toHaveBeenCalled();
    }
  );

  it('still closes the thread when the user explicitly selects All inboxes', () => {
    const { view, setLinksQuery } = mount();
    setLinksQuery({
      isSuccess: true,
      data: { links: [{ id: 'saved-inbox' }] },
    });

    view.setInboxIds(undefined);

    expect(view.state.inboxIds).toBeUndefined();
    expect(view.selectedThread()).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });
});
