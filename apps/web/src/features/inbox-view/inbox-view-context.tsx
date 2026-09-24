import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import type { PreviewPanelSelection } from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { inboxPreviewNavigation } from './inbox-preview-navigation';
import {
  INBOX_PREVIEW_SEARCH_NAMESPACE,
  inboxPreviewSearch,
  inboxPreviewSearchCodec,
  inboxPreviewSelection,
} from './inbox-route';
import { inboxTabSearch, inboxTabSearchCodec } from './inbox-tab-search';
import {
  createInboxViewPersistence,
  normalizeInboxFacets,
} from './persistence';
import { inboxPreviewRoute, inboxSplitRoute } from './route';
import type {
  InboxGroupBy,
  InboxTab,
  InboxViewState,
  InboxViewStateOptions,
} from './types';

type InboxViewProviderProps = ContextProviderProps & {
  initialState?: InboxViewStateOptions;
};

export type InboxViewContext = {
  state: Store<InboxViewState>;
  setState: SetStoreFunction<InboxViewState>;
  previewEntity: Accessor<PreviewPanelSelection | undefined>;
  /** Counts re-opens of the selection already previewed, such as a re-click. */
  previewNavigationRequest: Accessor<number>;
  openPreview: (entity: PreviewPanelSelection) => boolean;
  closePreview: () => void;
  setTab: (tab: InboxTab) => void;
  setFacets: (facets: FacetSelection) => void;
};

function defaultGroupBy(tab: InboxTab): InboxGroupBy {
  return tab === 'reminders' ? 'none' : 'date';
}

export const [InboxViewProvider, useInboxView] = createAssertedContextProvider<
  InboxViewContext,
  InboxViewProviderProps
>('InboxView', (props) => {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const navigate = useNavigate();
  const routeParams = useRouteParams(inboxPreviewRoute);
  const [previewSearch] = createSearchParams(inboxPreviewSearch);
  const [tabSearch] = createSearchParams(inboxTabSearch);
  const selectPreview = createPreviewSelectionGuard();
  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'signal';
  const [state, setState] = makePersistedState(
    createStore<InboxViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      groupBy: initial.groupBy ?? defaultGroupBy(initialTab),
      facets: normalizeInboxFacets(initial.facets),
    }),
    createInboxViewPersistence({
      handle: panel.handle,
      userId,
      restoreEntryState: props.initialState === undefined,
      restorePreferences: initial.facets === undefined,
    })
  );

  createEffect(
    on(
      () => tabSearch.tab,
      (tab) => {
        if (state.tab === tab) return;
        setState(
          produce((draft) => {
            draft.tab = tab;
            draft.groupBy = defaultGroupBy(tab);
          })
        );
      }
    )
  );

  const previewEntity = createMemo<PreviewPanelSelection | undefined>(() => {
    const blockType = routeParams.blockType;
    const previewId = routeParams.previewId;
    if (typeof blockType !== 'string' || typeof previewId !== 'string') return;
    return inboxPreviewSelection({ blockType, previewId }, previewSearch);
  });
  const navigatePreview = (entity: PreviewPanelSelection, replace = false) => {
    const preview = inboxPreviewNavigation(entity);
    navigate(
      { route: inboxPreviewRoute, params: preview.params },
      {
        replace,
        search: {
          [INBOX_PREVIEW_SEARCH_NAMESPACE]: inboxPreviewSearchCodec.serialize(
            preview.search
          ),
          [inboxTabSearch.namespace]: inboxTabSearchCodec.serialize({
            tab: state.tab,
          }),
        },
      }
    );
  };
  const closePreview = () =>
    navigate(
      { route: inboxSplitRoute, params: {} },
      {
        search: {
          [inboxTabSearch.namespace]: inboxTabSearchCodec.serialize({
            tab: state.tab,
          }),
        },
      }
    );
  const [previewNavigationRequest, setPreviewNavigationRequest] =
    createSignal(0);
  // Re-opening the previewed selection leaves the route unchanged, so the
  // preview sees no new selection; the request asks it to navigate again.
  const isPreviewed = (entity: PreviewPanelSelection) => {
    const current = previewEntity();
    return (
      current !== undefined &&
      JSON.stringify(inboxPreviewNavigation(current)) ===
        JSON.stringify(inboxPreviewNavigation(entity))
    );
  };
  const openPreview = (entity: PreviewPanelSelection) => {
    if (!selectPreview.canSelect(entity)) return false;
    if (isPreviewed(entity)) {
      setPreviewNavigationRequest((count) => count + 1);
      return true;
    }
    navigatePreview(entity);
    return true;
  };

  createEffect(
    on(previewEntity, (entity, previous) => {
      if (selectPreview(entity)) return;
      if (previous) navigatePreview(previous, true);
      else
        navigate(
          { route: inboxSplitRoute, params: {} },
          {
            replace: true,
            search: {
              [inboxTabSearch.namespace]: inboxTabSearchCodec.serialize({
                tab: state.tab,
              }),
            },
          }
        );
    })
  );

  const setTab = (tab: InboxTab) => {
    if (state.tab === tab) return;
    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.groupBy = defaultGroupBy(tab);
      })
    );
    closePreview();
  };

  const setFacets = (facets: FacetSelection) => {
    setState('facets', reconcile(normalizeInboxFacets(facets)));
  };

  return {
    state,
    setState,
    previewEntity,
    previewNavigationRequest,
    openPreview,
    closePreview,
    setTab,
    setFacets,
  };
});
