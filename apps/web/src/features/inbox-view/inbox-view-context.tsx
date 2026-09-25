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
import { useInboxCalendarPreview } from './inbox-calendar-preview';
import {
  type InboxPreviewNavigation,
  inboxDetailSearch,
  inboxPreviewTargetNavigation,
} from './inbox-preview-navigation';
import { inboxDetailParamsFromRoute, inboxPreviewTarget } from './inbox-route';
import { isInboxDocumentType } from './inbox-route-schema';
import { inboxTabSearch, inboxTabSearchCodec } from './inbox-tab-search';
import {
  createInboxViewPersistence,
  normalizeInboxFacets,
} from './persistence';
import {
  inboxChannelRoute,
  inboxDocumentRoute,
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
  /** Re-aim a target when the selected row is opened again at the same URL. */
  previewNavigationRequest: Accessor<number>;
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
  const routeParams =
    useParams<Parameters<typeof inboxDetailParamsFromRoute>[0]>();
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(driveSearch);
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
    const params = inboxDetailParamsFromRoute(routeParams);
    if (!params) return;
    return inboxPreviewTarget(params, {
      channel: channelSearch,
      document: documentSearch,
    });
  });
  const withTab = (
    search: Record<string, SerializedSearchParams | undefined>
  ) => ({
    ...search,
    [inboxTabSearch.namespace]: inboxTabSearchCodec.serialize({
      tab: state.tab,
    }),
  });
  const { calendarOpen, calendarRefocus, openCalendarEvent } =
    useInboxCalendarPreview(withTab);
  const navigateDetail = (
    { params, search }: InboxPreviewNavigation,
    replace = false
  ) => {
    const { blockType, previewId } = params;
    const target =
      blockType === 'channel'
        ? { route: inboxChannelRoute, params: { channelId: previewId } }
        : isInboxDocumentType(blockType)
          ? {
              route: inboxDocumentRoute,
              params: { documentType: blockType, documentId: previewId },
            }
          : { route: inboxPreviewRoute, params };
    navigate(target, { replace, search: withTab(search) });
  };
  const navigateTarget = (target: PreviewBlockTarget, replace = false) =>
    navigateDetail(inboxPreviewTargetNavigation(target), replace);
  const closePreview = () =>
    navigate(
      { route: inboxSplitRoute, params: {} },
      { search: withTab(inboxDetailSearch()) }
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
        inboxPreviewTargetNavigation(current),
        inboxPreviewTargetNavigation(target)
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
    previewNavigationRequest,
    calendarOpen,
    calendarRefocus,
    openPreview,
    closePreview,
    setTab,
    setFacets,
  };
});
