import { defineBlock, LoadErrors, loadResult } from '@core/block';
import { lazy } from '@core/util/lazy';

export const definition = defineBlock({
  name: 'database',
  description: 'View a table',
  component: lazy(() => import('./component/Block')),
  // The gateway fan-out that keeps grids fresh is keyed on the tracked
  // `database` entity, so the block has to announce itself as open.
  liveTrackingEnabled: true,
  // A database is not a soup entity and not a cloud-storage item, so the
  // open-tracking path (history row + soup refetch) has nothing to write.
  openTrackingEnabled: false,
  // Opening a database is still a product signal. Calendar, the other block
  // without history, stays off: it always loads one fixed id and `open_view`
  // already counts it.
  openAnalyticsEnabled: true,
  editPermissionEnabled: true,
  async load(source, _intent) {
    if (source.type !== 'dss') return LoadErrors.MISSING;
    const { loadDatabase } = await import('./queries/load-database');
    return await loadResult(loadDatabase(source.id));
  },
  accepted: {},
  defaultFilename: 'Untitled database',
});
