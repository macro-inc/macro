import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  useNewAppViews,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/registered-view';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMemo, Show } from 'solid-js';
import { DriveDetailView } from './components/DriveDetailView';
import { useDriveView } from './context/drive-context';
import { driveLocationBreadcrumbs } from './core/breadcrumbs';
import { DriveView, type DriveViewProps } from './drive-view';

export type DriveRouteViewProps = DriveViewProps & {
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

function mergeClientFilters(
  base?: SetPredicatesInput<string>,
  refinement?: SetPredicatesInput<string>
): SetPredicatesInput<string> | undefined {
  if (!base) return refinement;
  if (!refinement) return base;

  return {
    and: [...new Set([...(base.and ?? []), ...(refinement.and ?? [])])],
    or: [...new Set([...(base.or ?? []), ...(refinement.or ?? [])])],
  };
}

export const RegisteredDriveRouteView = withAuth(
  (props: DriveRouteViewProps = {}) => {
    usePageViewTracking('documents');
    const newAppViews = useNewAppViews({
      enabledLayout: () => (isTouchDevice() ? 'legacy' : 'composable'),
    });
    const user = useUserContext();
    const preset = getViewPreset('documents', undefined, {
      userId: user.userId(),
      isTeamAdmin: false,
    });
    const initialFilters =
      preset?.filters && props.initialFilters
        ? mergeQuery(queryStateFrom(preset.filters), props.initialFilters)
        : (props.initialFilters ?? preset?.filters);
    const initialClientFilters = mergeClientFilters(
      preset?.clientFilters,
      props.initialClientFilters
    );

    return (
      <Show when={newAppViews.ready()} fallback={<LoadingBlock />}>
        <Show
          when={newAppViews.enabled() && !isTouchDevice()}
          fallback={
            <SoupView
              viewName="Files"
              initialFilters={initialFilters}
              initialClientFilters={initialClientFilters}
              initialGroupBy={preset?.groupBy}
            />
          }
        >
          <DriveView initialFacets={props.initialFacets} />
        </Show>
      </Show>
    );
  }
);

export function DriveDetailRouteView() {
  const { state, sidebar } = useDriveView();
  const breadcrumbOrderOffset = createMemo(
    () =>
      driveLocationBreadcrumbs(state.value().location, sidebar.folders()).length
  );

  return <DriveDetailView breadcrumbOrderOffset={breadcrumbOrderOffset()} />;
}

export function DriveRouteView() {
  const panel = useSplitPanelOrThrow();
  const content = panel.handle.content();
  const params =
    content.type === 'component' && content.id === 'documents'
      ? (content.params as DriveRouteViewProps | undefined)
      : undefined;

  return <RegisteredDriveRouteView {...params} />;
}
