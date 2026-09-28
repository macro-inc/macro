import { channelsSearch } from '@app/features/channels-view/channels-route';
import { driveSearch } from '@app/features/drive-view/primitives/drive-search';
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  type SerializedSearchParams,
  useNavigate,
  useParams,
} from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  type PreviewBlockTarget,
  type PreviewSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import deepEqual from 'fast-deep-equal';
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
import { useHomeCalendarPreview } from './home-calendar-preview';
import {
  type HomePreviewNavigation,
  homeDetailSearch,
  homePreviewTargetNavigation,
} from './home-preview-navigation';
import { homeDetailParamsFromRoute, homePreviewTarget } from './home-route';
import { isHomeDocumentType } from './home-route-schema';
import { homeTabSearch, homeTabSearchCodec } from './home-tab-search';
import { createHomeViewPersistence, normalizeHomeFacets } from './persistence';
import {
  homeChannelRoute,
  homeDocumentRoute,
  homePreviewRoute,
  homeSplitRoute,
} from './route';
import type {
  HomeGroupBy,
  HomeTab,
  HomeViewState,
  HomeViewStateOptions,
} from './types';

type HomeViewProviderProps = ContextProviderProps & {
  initialState?: HomeViewStateOptions;
};

export type HomeViewContext = {
  state: Store<HomeViewState>;
  setState: SetStoreFunction<HomeViewState>;
  /** The block the route currently opens inline, if any. */
  previewTarget: Accessor<PreviewBlockTarget | undefined>;
  /** Re-aim a target when the selected row is opened again at the same URL. */
  previewNavigationRequest: Accessor<number>;
  /** Whether the route opens the Calendar view inline. */
  calendarOpen: Accessor<boolean>;
  /** Bumped when the open calendar event is requested again, to re-aim in place. */
  calendarRefocus: Accessor<number>;
  openPreview: (entity: PreviewSelection) => boolean;
  closePreview: () => void;
  setTab: (tab: HomeTab) => void;
  setFacets: (facets: FacetSelection) => void;
};

function defaultGroupBy(tab: HomeTab): HomeGroupBy {
  return tab === 'reminders' ? 'none' : 'date';
}

export const [HomeViewProvider, useHomeView] = createAssertedContextProvider<
  HomeViewContext,
  HomeViewProviderProps
>('HomeView', (props) => {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const navigate = useNavigate();
  const routeParams =
    useParams<Parameters<typeof homeDetailParamsFromRoute>[0]>();
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(driveSearch);
  const [tabSearch] = createSearchParams(homeTabSearch);
  const selectPreview = createPreviewSelectionGuard();
  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'signal';
  const [state, setState] = makePersistedState(
    createStore<HomeViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      groupBy: initial.groupBy ?? defaultGroupBy(initialTab),
      facets: normalizeHomeFacets(initial.facets),
    }),
    createHomeViewPersistence({
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

  const previewTarget = createMemo<PreviewBlockTarget | undefined>(() => {
    const params = homeDetailParamsFromRoute(routeParams);
    if (!params) return;
    return homePreviewTarget(params, {
      channel: channelSearch,
      document: documentSearch,
    });
  });
  const withTab = (
    search: Record<string, SerializedSearchParams | undefined>
  ) => ({
    ...search,
    [homeTabSearch.namespace]: homeTabSearchCodec.serialize({
      tab: state.tab,
    }),
  });
  const { calendarOpen, calendarRefocus, openCalendarEvent } =
    useHomeCalendarPreview(withTab);
  const navigateDetail = (
    { params, search }: HomePreviewNavigation,
    replace = false
  ) => {
    const { blockType, previewId } = params;
    const target =
      blockType === 'channel'
        ? { route: homeChannelRoute, params: { channelId: previewId } }
        : isHomeDocumentType(blockType)
          ? {
              route: homeDocumentRoute,
              params: { documentType: blockType, documentId: previewId },
            }
          : { route: homePreviewRoute, params };
    navigate(target, { replace, search: withTab(search) });
  };
  const navigateTarget = (target: PreviewBlockTarget, replace = false) =>
    navigateDetail(homePreviewTargetNavigation(target), replace);
  const closePreview = () =>
    navigate(
      { route: homeSplitRoute, params: {} },
      { search: withTab(homeDetailSearch()) }
    );
  const [previewNavigationRequest, setPreviewNavigationRequest] =
    createSignal(0);
  const openPreview = (entity: PreviewSelection) => {
    if (entity.type === 'calendar_event') {
      return openCalendarEvent(entity);
    }
    const target = previewBlockTarget(entity);
    if (!selectPreview.canSelect(target)) return false;
    const current = previewTarget();
    if (
      current &&
      deepEqual(
        homePreviewTargetNavigation(current),
        homePreviewTargetNavigation(target)
      )
    ) {
      setPreviewNavigationRequest((count) => count + 1);
      return true;
    }
    navigateTarget(target);
    return true;
  };

  createEffect(
    on(previewTarget, (target, previous) => {
      if (selectPreview(target)) return;
      if (previous) navigateTarget(previous, true);
      else
        navigate(
          { route: homeSplitRoute, params: {} },
          { replace: true, search: withTab(homeDetailSearch()) }
        );
    })
  );

  const setTab = (tab: HomeTab) => {
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
    setState('facets', reconcile(normalizeHomeFacets(facets)));
  };

  return {
    state,
    setState,
    previewTarget,
    previewNavigationRequest,
    calendarOpen,
    calendarRefocus,
    openPreview,
    closePreview,
    setTab,
    setFacets,
  };
});
