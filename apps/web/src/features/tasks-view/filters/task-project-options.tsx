import type { SearchableOptionSourceFactory } from '@app/features/next-soup/soup-view/filters-bar/option-source';
import type { SearchableOption } from '@app/features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { createProjectIdentityQuery } from '@app/features/projects/queries/project-identity';
import { createProjectSoupSource } from '@app/features/projects/queries/project-soup';
import { useUserId } from '@core/context/user';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import ProjectIcon from '@icon/system/regular/cube.svg';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createSignal, mapArray } from 'solid-js';

const projectOption = (id: string, name: string): SearchableOption => ({
  id,
  label: name,
  icon: () => <ProjectIcon class="size-3.5 shrink-0" />,
});

/** Selected IDs stay editable even when a project is absent from the current page. */
export function useTaskProjectLabels(
  ids: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  const viewer = useUserId();
  const queries = mapArray(ids, (id) => ({
    id,
    query: createProjectIdentityQuery(
      getGraphqlSoupClient,
      viewer,
      () => id,
      enabled
    ),
  }));
  return () =>
    queries().map(({ id, query }) =>
      projectOption(
        id,
        (query.isSuccess ? query.data?.name : undefined) ??
          'Unavailable project'
      )
    );
}

/** Reuses the project picker's authorized, searchable, paginated collection. */
export function taskProjectSource(
  projectsEnabled: Accessor<boolean>
): SearchableOptionSourceFactory {
  return (selected, enabled) => {
    const viewer = useUserId();
    const [search, setSearch] = createSignal('');
    const query = debouncedDependent(search, 150);
    const active = () => enabled() && projectsEnabled() && Boolean(viewer());
    const source = createProjectSoupSource(
      getGraphqlSoupClient,
      () => ({ query: query().trim() || undefined, sort: 'updated' }),
      active
    );
    const labels = useTaskProjectLabels(selected, projectsEnabled);
    const options = () => {
      const values = new Map(labels().map((option) => [option.id, option]));
      for (const { project } of source.rows() ?? []) {
        values.set(project.id, projectOption(project.id, project.name));
      }
      return [...values.values()];
    };
    return {
      options,
      search,
      setSearch,
      windowKey: () => (source.loading() ? undefined : query()),
      visibleIds: () => {
        const term = query().trim().toLowerCase();
        return options()
          .filter(
            (option) => !term || option.label.toLowerCase().includes(term)
          )
          .map(({ id }) => id);
      },
      loading: () => source.loading() || source.loadingMore(),
      error: () => Boolean(source.error()),
      incomplete: () => false,
      hasNext: source.hasMore,
      next: () => fireAndForget(source.loadMore(), 'tasks'),
      retry: source.refresh,
    };
  };
}
