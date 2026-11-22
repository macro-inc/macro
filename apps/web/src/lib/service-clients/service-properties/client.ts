import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { registerClient } from '@core/util/mockClient';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
import type { BulkEntityPropertiesRequest } from './generated/schemas/bulkEntityPropertiesRequest';
import type { BulkUpdateEntityPropertyOptionsRequest } from './generated/schemas/bulkUpdateEntityPropertyOptionsRequest';
import type { BulkUpdateEntityPropertyOptionsResponse } from './generated/schemas/bulkUpdateEntityPropertyOptionsResponse';
import type { EntityPropertiesResponse } from './generated/schemas/entityPropertiesResponse';
import type { GetBulkEntityProperties200 } from './generated/schemas/getBulkEntityProperties200';
import type { GetEntityPropertiesParams } from './generated/schemas/getEntityPropertiesParams';
import type { PropertyTargetEntityType } from './generated/schemas/propertyTargetEntityType';

type PropertiesEntityType = PropertyTargetEntityType;

type GetEntityPropertiesArgs = {
  entity_type: PropertyTargetEntityType;
  entity_id: string;
  query: GetEntityPropertiesParams;
};
type DeleteEntityPropertyArgs = {
  entity_property_id: string;
};
type EntityPropertyOptionArgs = {
  entity_type: PropertyTargetEntityType;
  entity_id: string;
  property_id: string;
  option_id: string;
};
type BulkUpdateEntityPropertyOptionsArgs = {
  entity_type: PropertyTargetEntityType;
  entity_id: string;
  body: BulkUpdateEntityPropertyOptionsRequest;
};
type GetBulkEntityPropertiesArgs = {
  body: BulkEntityPropertiesRequest;
};

const propertiesHost: string = SERVER_HOSTS['document-storage-service'];

function propertiesFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function propertiesFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function propertiesFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${propertiesHost}${url}`, init);
}

export const propertiesServiceClient = {
  getEntityProperties: async (args: GetEntityPropertiesArgs) => {
    const queryParams = new URLSearchParams();

    if (args.query.include_metadata !== undefined) {
      queryParams.set('include_metadata', String(args.query.include_metadata));
    }

    const queryString = queryParams.toString();
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}${queryString ? `?${queryString}` : ''}`;

    return await propertiesFetch<EntityPropertiesResponse>(url, {
      method: 'GET',
    });
  },

  deleteEntityProperty: async (args: DeleteEntityPropertyArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/entity_properties/${args.entity_property_id}`,
      {
        method: 'DELETE',
      }
    );

    return result.map(() => ({ success: true }));
  },

  addEntityPropertyOption: async (args: EntityPropertyOptionArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/${args.property_id}/options/${args.option_id}`;
    const result = await propertiesFetch<{}>(url, {
      method: 'POST',
    });
    return result.map(() => ({ success: true }));
  },

  removeEntityPropertyOption: async (args: EntityPropertyOptionArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/${args.property_id}/options/${args.option_id}`;
    const result = await propertiesFetch<{}>(url, {
      method: 'DELETE',
    });
    return result.map(() => ({ success: true }));
  },

  bulkUpdateEntityPropertyOptions: async (
    args: BulkUpdateEntityPropertyOptionsArgs
  ) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/options/bulk`;
    return await propertiesFetch<BulkUpdateEntityPropertyOptionsResponse>(url, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  getBulkEntityProperties: async (args: GetBulkEntityPropertiesArgs) => {
    return await propertiesFetch<GetBulkEntityProperties200>(
      `/properties/entities/bulk`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
      }
    );
  },
};

registerClient('properties', propertiesServiceClient);

export type { PropertiesEntityType };
