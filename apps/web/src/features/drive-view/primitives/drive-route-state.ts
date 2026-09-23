import {
  type FacetSelection,
  normalizeFacetSelection,
} from '@app/features/soup';
import {
  createSearchParams,
  type SplitNavigateOptions,
  useNavigate,
  useParams,
} from '@app/split-router';
import { useEntryState } from '@components/app/split-layout/entry-state';
import deepEqual from 'fast-deep-equal';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  type Setter,
} from 'solid-js';
import type { DriveLocation, DriveState } from '../core/types';
import { driveDestination } from '../drive-route-navigation';
import {
  type DriveRouteParams,
  type DriveSearchParams,
  driveLocationFromParams,
  driveSearch,
} from './drive-route';

type NavigationOptions = Pick<
  SplitNavigateOptions<unknown>,
  'replace' | 'target'
>;

/** URL-owned Drive selection and the one-time legacy launch-facet handoff. */
export function createDriveRouteState(
  initialFacets: Accessor<FacetSelection | undefined>
) {
  const params = useParams<DriveRouteParams>();
  const navigate = useNavigate();
  const [search, setSearch] = createSearchParams(driveSearch);
  const location = createMemo(() => driveLocationFromParams(params));
  const seed = normalizeFacetSelection(initialFacets());
  const [seeding, setSeeding] = createSignal(
    Object.keys(search.facets).length === 0 && Object.keys(seed).length > 0
  );
  const facets = () => (seeding() ? seed : search.facets);
  onMount(() => {
    if (!seeding()) return;
    batch(() => {
      setSearch({ facets: seed }, { history: 'replace' });
      setSeeding(false);
    });
  });

  return {
    location,
    selection: () => ({
      location: location(),
      scope: search.scope,
      sort: search.sort,
      facets: facets(),
    }),
    setSearch,
    navigate(
      location: DriveLocation,
      search: DriveSearchParams,
      options: NavigationOptions = {}
    ) {
      navigate(driveDestination(location), {
        ...options,
        search: {
          drive: driveSearch.serialize(search, {
            defaults: driveSearch.defaults,
          }),
        },
      });
    },
  };
}
export type DriveRouteState = ReturnType<typeof createDriveRouteState>;

const routeSearch = ({
  scope,
  sort,
  facets,
}: DriveState): DriveSearchParams => ({
  scope,
  sort,
  facets: normalizeFacetSelection(facets),
});

/** Restored entry state supplies UI state; the current URL always wins selection. */
export function createDriveViewState(
  route: DriveRouteState,
  onRouteChange: () => void
) {
  const [saved, setSaved] = useEntryState<DriveState>('drive.view.v2', {
    default: {
      ...route.selection(),
      search: '',
      expandedFolderIds: [],
      favoritesOpen: true,
      rootOpen: true,
      tagsOpen: true,
    },
  });
  const value = (): DriveState => ({ ...saved(), ...route.selection() });
  const update = (next: DriveState, options: NavigationOptions = {}) => {
    const previous = value();
    setSaved(() => next);
    if (!deepEqual(next.location, previous.location)) {
      route.navigate(next.location, routeSearch(next), options);
    } else if (!deepEqual(routeSearch(next), routeSearch(previous))) {
      route.setSearch(routeSearch(next), {
        mode: 'replace',
        history: options.replace ? 'replace' : 'push',
      });
    }
    return next;
  };
  const setValue: Setter<DriveState> = (next) =>
    update(typeof next === 'function' ? next(value()) : next);

  createEffect(
    on(
      route.selection,
      (selection) => {
        const current = saved();
        const locationChanged = !deepEqual(
          current.location,
          selection.location
        );
        if (
          !locationChanged &&
          deepEqual(
            routeSearch(current),
            routeSearch({ ...current, ...selection })
          )
        )
          return;
        setSaved({
          ...current,
          ...selection,
          search: locationChanged ? '' : current.search,
        });
        onRouteChange();
      },
      { defer: true }
    )
  );

  return { value, setValue, update };
}
