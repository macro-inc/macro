import { defineBlock, LoadErrors, loadResult } from '@core/block';
import NotFound from '@core/component/AccessErrorViews/NotFound';
import { lazy } from 'solid-js';
import { waitForDatabaseRollout } from './queries/database-rollout';

export const definition = defineBlock({
  name: 'database',
  description: 'View a table',
  // Off, a database link is a 404 and the block's bundle is never fetched:
  // the loader preloads this component alongside `load`.
  component: lazy(async () =>
    (await waitForDatabaseRollout())
      ? import('./component/Block')
      : { default: NotFound }
  ),
  // The gateway fan-out that keeps grids fresh is keyed on the tracked
  // `database` entity, so the block has to announce itself as open.
  liveTrackingEnabled: true,
  // A database is not a soup entity and not a cloud-storage item, so the
  // open-tracking path (history row + soup refetch) has nothing to write.
  openTrackingEnabled: false,
  editPermissionEnabled: true,
  async load(source, _intent) {
    if (!(await waitForDatabaseRollout())) return LoadErrors.MISSING;
    if (source.type !== 'dss') return LoadErrors.MISSING;
    const { loadDatabase } = await import('./queries/load-database');
    return await loadResult(loadDatabase(source.id));
  },
  accepted: {},
  defaultFilename: 'Untitled database',
});
