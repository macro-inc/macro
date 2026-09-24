import {
  calendarSearch,
  calendarSearchTarget,
  calendarTargetSearch,
} from '@app/features/calendar-view/calendar-url';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  type SerializedSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  type PreviewBlockTarget,
  type PreviewSelection,
  previewBlockTarget,
  previewCalendarTarget,
} from '@components/app/previewTarget';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
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
import {
  type InboxCalendarNavigation,
  type InboxPreviewNavigation,
  inboxCalendarNavigation,
  inboxDetailSearch,
  inboxPreviewTargetNavigation,
} from './inbox-preview-navigation';
import { inboxPreviewTarget } from './inbox-route';
import { inboxDocumentSearch } from './inbox-route-schema';
import { inboxTabSearch, inboxTabSearchCodec } from './inbox-tab-search';
import {
  createInboxViewPersistence,
  normalizeInboxFacets,
} from './persistence';
import {
  inboxCalendarRoute,
  inboxPreviewRoute,
  inboxSplitRoute,
} from './route';
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
  /** The block the route currently opens inline, if any. */
  previewTarget: Accessor<PreviewBlockTarget | undefined>;
  /** Whether the route opens the Calendar view inline. */
  calendarOpen: Accessor<boolean>;
  /** Bumped when the open calendar event is requested again, to re-aim in place. */
  calendarRefocus: Accessor<number>;
  openPreview: (entity: PreviewSelection) => boolean;
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
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(inboxDocumentSearch);
  const calendarParams = useRouteParams(inboxCalendarRoute);
  const [openCalendarSearch] = createSearchParams(calendarSearch);
  const [calendarRefocus, setCalendarRefocus] = createSignal(0);
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

  const previewTarget = createMemo<PreviewBlockTarget | undefined>(() => {
    const blockType = routeParams.blockType;
    const previewId = routeParams.previewId;
    if (typeof blockType !== 'string' || typeof previewId !== 'string') return;
    return inboxPreviewTarget(
      { blockType, previewId },
      { channel: channelSearch, document: documentSearch }
    );
  });
  const calendarOpen = () => typeof calendarParams.period === 'string';
  const withTab = (
    search: Record<string, SerializedSearchParams | undefined>
  ) => ({
    ...search,
    [inboxTabSearch.namespace]: inboxTabSearchCodec.serialize({
      tab: state.tab,
    }),
  });
  const navigateDetail = (
    { params, search }: InboxPreviewNavigation,
    replace = false
  ) =>
    navigate(
      { route: inboxPreviewRoute, params },
      { replace, search: withTab(search) }
    );
  const navigateCalendar = ({ params, search }: InboxCalendarNavigation) =>
    navigate(
      { route: inboxCalendarRoute, params },
      { search: withTab(search) }
    );
  const navigateTarget = (target: PreviewBlockTarget, replace = false) =>
    navigateDetail(inboxPreviewTargetNavigation(target), replace);
  const closePreview = () =>
    navigate(
      { route: inboxSplitRoute, params: {} },
      { search: withTab(inboxDetailSearch()) }
    );
  const openPreview = (entity: PreviewSelection) => {
    if (entity.type === 'calendar_event') {
      // Calendar events render the Calendar view inline, aimed at the event.
      if (!isFeatureEnabled(enableCalendarUi)) return false;
      const calendarTarget = previewCalendarTarget(entity);
      const navigation = inboxCalendarNavigation(calendarTarget);
      if (!navigation) return false;
      const alreadyOpen =
        calendarOpen() &&
        calendarParams.period === navigation.params.period &&
        deepEqual(
          calendarTargetSearch(calendarTarget),
          calendarTargetSearch(calendarSearchTarget(openCalendarSearch))
        );
      // Same destination: leave the URL alone and bring the event back into view.
      if (alreadyOpen) setCalendarRefocus((count) => count + 1);
      else navigateCalendar(navigation);
      return true;
    }
    const target = previewBlockTarget(entity);
    if (!selectPreview.canSelect(target)) return false;
    navigateTarget(target);
    return true;
  };

  createEffect(
    on(previewTarget, (target, previous) => {
      if (selectPreview(target)) return;
      if (previous) navigateTarget(previous, true);
      else
        navigate(
          { route: inboxSplitRoute, params: {} },
          { replace: true, search: withTab(inboxDetailSearch()) }
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
    previewTarget,
    calendarOpen,
    calendarRefocus,
    openPreview,
    closePreview,
    setTab,
    setFacets,
  };
});
