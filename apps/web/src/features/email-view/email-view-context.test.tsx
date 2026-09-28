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
}));

vi.mock('@app/components/list', () => ({
  createListController: () => ({}),
  listOwnedSlotName: (name: string) => name,
}));
vi.mock('@app/components/view-shell', () => ({}));
vi.mock('@app/features/next-soup/soup-view/inbox-filter-controllers', () => ({
  registerInboxFilterSplit: () => () => {},
}));
vi.mock(
  '@app/features/soup',
  async () => import('../soup/filters/facets/selection')
);
vi.mock('@app/features/soup/collection/list-navigation-source', () => ({
  registerListNavigationSource: () => {},
}));
vi.mock('@app/lib/persistence', () => ({
  makePersistedState: <T,>(store: T) => store,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouteParams: () => mocks.useRouteParams(),
  createSearchParams: () => [{ tab: 'important' }],
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
});

function mount() {
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
    <EmailViewProvider initialState={{ inboxIds: ['saved-inbox'] }}>
      <ReadContext />
    </EmailViewProvider>
  ));
  return { view, setLinksQuery };
}

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
