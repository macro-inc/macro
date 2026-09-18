import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { storageServiceClient } from '@service-storage/client';
import { lazy } from 'solid-js';

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
  editPermissionEnabled: true,
  async load(source, _intent) {
    if (source.type !== 'dss') return LoadErrors.MISSING;
    return await loadResult(
      storageServiceClient.databases.get({ id: source.id })
    );
  },
  accepted: {},
  defaultFilename: 'Untitled table',
});

export type DatabaseData = ExtractLoadType<(typeof definition)['load']>;
