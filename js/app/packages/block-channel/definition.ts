import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { fetchEntityPermissions } from '@queries/entity/permissions';
import { getEntityChannelRole } from '@queries/entity/permissionUtils';
import ChannelBlock from './component/Block';

export const definition = defineBlock({
  name: 'channel',
  description: '',
  component: ChannelBlock,
  liveTrackingEnabled: true,
  async load(source, _intent) {
    if (source.type === 'dss') {
      const permissions = await fetchEntityPermissions('channel', source.id);

      if (isErr(permissions)) {
        if (isErr(permissions, 'NOT_FOUND')) {
          return LoadErrors.MISSING;
        }
        if (isErr(permissions, 'UNAUTHORIZED')) {
          return LoadErrors.UNAUTHORIZED;
        }
        if (isErr(permissions, 'GONE')) {
          return LoadErrors.GONE;
        }
        return LoadErrors.INVALID;
      }

      const [, permission] = permissions;

      if (getEntityChannelRole(permission) == null) {
        return LoadErrors.UNAUTHORIZED;
      }

      return ok({
        id: source.id,
      });
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChannelData = ExtractLoadType<(typeof definition)['load']>;
