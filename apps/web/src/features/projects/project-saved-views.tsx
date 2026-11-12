import { createSearchParams } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { createSavedViewDraft } from '../saved-views/primitives/create-saved-view-draft';
import {
  useSavedView,
  useSavedViews,
} from '../saved-views/queries/saved-views';
import { ProjectSavedViewsContext } from './context/project-saved-views-context';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectCollectionSettings,
  type ProjectScope,
} from './core/project';
import {
  captureProjectSavedView,
  decodeProjectSavedView,
  projectSavedViewsEqual,
  readProjectSavedView,
} from './core/project-saved-view';
import { createProjectCollectionPersistence } from './project-collection-persistence';
import { projectCollectionSearch } from './project-collection-search';

export function createProjectSavedViews(props: {
  active: Accessor<boolean>;
  scope: Accessor<ProjectScope>;
  enabled: Accessor<boolean>;
  location: Accessor<unknown>;
  onSelect: (id?: string, scope?: ProjectScope) => void;
}) {
  const viewerId = useUserId();
  const panel = useSplitPanelOrThrow();
  const teamQuery = useCurrentTeamQuery();
  const [search] = createSearchParams(projectCollectionSearch);
  const initial = createProjectCollectionPersistence(panel.handle).initialState;
  const [state, setState] = createStore({
    scope: props.scope(),
    creating: false,
    settings: {
      layout: initial?.layout ?? 'list',
      status: initial?.status ?? '',
      priority: initial?.priority ?? '',
      dueBefore: initial?.dueBefore ?? '',
      dueAfter: initial?.dueAfter ?? '',
      mine: initial?.mine ?? false,
      sort: initial?.sort ?? 'updated',
      groupBy: initial?.groupBy ?? 'status',
    },
  });
  const selectedId = () =>
    props.active() && props.enabled() ? search.savedView : undefined;
  const source = useSavedView({ viewerId, id: selectedId });
  const list = useSavedViews({
    viewerId: () => (props.enabled() ? viewerId() : undefined),
    kind: 'projects',
  });
  const scope = () => (selectedId() ? state.scope : props.scope());
  const draft = createSavedViewDraft({
    source,
    selectedId,
    viewerId,
    creating: () => state.creating,
    capture: () => captureProjectSavedView(state.settings, scope()),
    defaults: () =>
      captureProjectSavedView(DEFAULT_PROJECT_SETTINGS, props.scope()),
    read: readProjectSavedView,
    decode: decodeProjectSavedView,
    equal: projectSavedViewsEqual,
    apply: (config) =>
      setState({ settings: { ...config.settings }, scope: config.scope }),
    resetNew: () => setState('settings', { ...DEFAULT_PROJECT_SETTINGS }),
  });
  usePending(
    'projects.saved_views',
    () => props.active() && props.enabled() && list.loading()
  );
  usePending(
    'projects.saved_view',
    () => props.active() && draft.view().kind === 'loading'
  );
  const navigation = createMemo(() => ({
    selectedId: selectedId(),
    viewerId: viewerId(),
    location: props.location(),
    active: props.active(),
  }));
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const request = () => {
    const captured = navigation();
    return {
      revision: draft.revision(),
      isCurrent: () => alive && captured === navigation(),
    };
  };
  let createNavigationPending = false;
  // Route/account transitions discard temporary settings, not confirmed definitions.
  createEffect(
    on(
      () => [selectedId(), viewerId(), props.scope()] as const,
      ([id], previous) => {
        if (!previous) return;
        if (createNavigationPending && !id && props.active()) {
          createNavigationPending = false;
          return;
        }
        createNavigationPending = false;
        setState('creating', false);
        if (!id) setState('settings', { ...DEFAULT_PROJECT_SETTINGS });
      }
    )
  );
  createEffect(
    on(props.location, (_, previous) => {
      if (previous && selectedId()) draft.reset();
    })
  );
  const select = (id?: string) => {
    setState('creating', false);
    props.onSelect(id);
  };
  const start = () =>
    batch(() => {
      createNavigationPending = true;
      props.onSelect();
      setState({
        creating: true,
        settings: { ...DEFAULT_PROJECT_SETTINGS },
        scope: 'all',
      });
    });
  return {
    selectScope: (scope: ProjectScope) => {
      setState('creating', false);
      props.onSelect(undefined, scope);
    },
    viewerId,
    source,
    list,
    draft,
    selectedId,
    scope,
    request,
    select,
    start,
    creating: () => state.creating,
    active: props.active,
    ready: () => {
      const view = draft.view();
      if (view.kind === 'loading' || view.kind === 'unavailable') return false;
      return view.kind !== 'saved' || view.issues.length === 0;
    },
    settings: state.settings,
    persistentSettings: () => {
      if (!selectedId() && !state.creating) return state.settings;
      return draft.confirmed()?.config.settings ?? DEFAULT_PROJECT_SETTINGS;
    },
    updateSettings: (patch: Partial<ProjectCollectionSettings>) =>
      setState('settings', patch),
    team: () => {
      if (!queryReadyGate(teamQuery)) return;
      const team = teamQuery.data?.team;
      return team ? { id: team.id, name: team.name } : undefined;
    },
  };
}

export function ProjectSavedViewsProvider(
  props: ParentProps<Parameters<typeof createProjectSavedViews>[0]>
) {
  const context = createProjectSavedViews(props);
  return (
    <ProjectSavedViewsContext.Provider value={context}>
      {props.children}
    </ProjectSavedViewsContext.Provider>
  );
}
