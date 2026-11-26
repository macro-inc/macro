import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import deepEqual from 'fast-deep-equal';
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
import {
  createSavedViewCreation,
  type NewSavedView,
} from '../saved-views/primitives/create-saved-view-creation';
import { createSavedViewDraft } from '../saved-views/primitives/create-saved-view-draft';
import {
  useSavedView,
  useSavedViews,
} from '../saved-views/queries/saved-views';
import { SavedViewDraftHost } from '../saved-views/views/saved-view-draft-host';
import { ProjectSavedViewsContext } from './context/project-saved-views-context';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectCollectionSettings,
  type ProjectScope,
} from './core/project';
import {
  captureProjectSavedView,
  decodeProjectSavedView,
  type ProjectSavedViewConfig,
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
  registerLeave?: (run: (action: () => void) => void) => () => void;
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
  const scope = () =>
    selectedId() || state.creating ? state.scope : props.scope();
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
  const creation = createSavedViewCreation({
    kind: 'projects',
    viewerId,
    list: list.items,
    capture: () => {
      const value = draft.capture();
      return value.isOk() ? value.value : undefined;
    },
    equal: deepEqual,
    confirmed: () => setState('creating', false),
  });
  const discardNew = () => {
    creation.discard();
    setState('creating', false);
  };
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
      () => [selectedId(), viewerId(), props.scope(), props.active()] as const,
      ([id, viewer, , active], previous) => {
        if (!previous) return;
        const sameViewer = viewer === previous[1];
        if (createNavigationPending && sameViewer && !id && active) {
          createNavigationPending = false;
          return;
        }
        createNavigationPending = false;
        discardNew();
        if (!id) setState('settings', { ...DEFAULT_PROJECT_SETTINGS });
      }
    )
  );
  createEffect(
    on(props.location, (_, previous) => {
      if (previous && selectedId()) draft.reset();
    })
  );
  const selectCreated = (id: string) => {
    setState('creating', false);
    props.onSelect(id);
  };
  const select = (id?: string) =>
    creation.run(() => {
      discardNew();
      props.onSelect(id);
    });
  const start = (
    config?: ProjectSavedViewConfig,
    name = t('viewMenus.newView'),
    afterStart?: () => void,
    changed = false,
    appearance?: NewSavedView['appearance']
  ) =>
    creation.run(() => {
      batch(() => {
        createNavigationPending = true;
        creation.internalNavigation(() => props.onSelect());
        setState({
          creating: true,
          settings: { ...(config?.settings ?? DEFAULT_PROJECT_SETTINGS) },
          scope: config?.scope ?? 'all',
        });
        const captured = captureProjectSavedView(state.settings, state.scope);
        if (captured.isOk())
          creation.begin(captured.value, name, changed, appearance);
      });
      afterStart?.();
    });
  return {
    selectScope: (scope: ProjectScope) =>
      creation.run(() => {
        discardNew();
        props.onSelect(undefined, scope);
      }),
    creation,
    discardNew,
    selectCreated,
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
    settings: () => state.settings,
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
      <SavedViewDraftHost
        creation={context.creation}
        refresh={context.list.refresh}
        discard={context.discardNew}
        selection={{ projects: ['savedView'], tasks: ['tab', 'savedView'] }}
        registerLeave={props.registerLeave}
      />
      {props.children}
    </ProjectSavedViewsContext.Provider>
  );
}
