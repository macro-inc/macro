import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { registerClient } from '@core/util/mockClient';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
import type { AddPropertyOptionRequest } from './generated/schemas/addPropertyOptionRequest';
import type { BulkEntityPropertiesRequest } from './generated/schemas/bulkEntityPropertiesRequest';
import type { CreatePropertyDefinitionRequest } from './generated/schemas/createPropertyDefinitionRequest';
import type { EntityPropertiesResponse } from './generated/schemas/entityPropertiesResponse';
import type { EntityType } from './generated/schemas/entityType';
import type { GetBulkEntityProperties200 } from './generated/schemas/getBulkEntityProperties200';
import type { GetEntityPropertiesParams } from './generated/schemas/getEntityPropertiesParams';
import type { ListPropertiesParams } from './generated/schemas/listPropertiesParams';
import type { PropertyDefinition } from './generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from './generated/schemas/propertyDefinitionResponse';
import type { PropertyOption } from './generated/schemas/propertyOption';
import type { SetEntityPropertyRequest } from './generated/schemas/setEntityPropertyRequest';

type PropertiesEntityType = EntityType;

type ListPropertiesArgs = ListPropertiesParams;
type CreatePropertyDefinitionArgs = {
  body: CreatePropertyDefinitionRequest;
};
type DeletePropertyDefinitionArgs = {
  definition_id: string;
};
type GetEntityPropertiesArgs = {
  entity_type: EntityType;
  entity_id: string;
  query: GetEntityPropertiesParams;
};
type SetEntityPropertyArgs = {
  entity_type: EntityType;
  entity_id: string;
  property_id: string;
  body: SetEntityPropertyRequest;
};
type DeleteEntityPropertyArgs = {
  entity_property_id: string;
};
type GetPropertyOptionsArgs = {
  definition_id: string;
};
type AddPropertyOptionArgs = {
  definition_id: string;
  body: AddPropertyOptionRequest;
};
type DeletePropertyOptionArgs = {
  definition_id: string;
  option_id: string;
};
type SetPropertyStatusCompleteArgs = {
  entity_type: PropertiesEntityType;
  entity_id: string;
};
type GetBulkEntityPropertiesArgs = {
  body: BulkEntityPropertiesRequest;
};

const propertiesHost: string = SERVER_HOSTS['document-storage-service'];

export function propertiesFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
export function propertiesFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
export function propertiesFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${propertiesHost}${url}`, init);
}

export const propertiesServiceClient = {
  listProperties: async (args: ListPropertiesArgs) => {
    const queryParams = new URLSearchParams();
    queryParams.set('scope', args.scope);
    if (args.include_options !== undefined) {
      queryParams.set('include_options', String(args.include_options));
    }
    if (args.for_entity_type !== undefined && args.for_entity_type !== null) {
      queryParams.set('for_entity_type', args.for_entity_type);
    }

    return await propertiesFetch<PropertyDefinitionResponse[]>(
      `/properties/definitions?${queryParams}`,
      {
        method: 'GET',
      }
    );
  },

  createPropertyDefinition: async (args: CreatePropertyDefinitionArgs) => {
    return await propertiesFetch<PropertyDefinition>(
      `/properties/definitions`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
      }
    );
  },

  deletePropertyDefinition: async (args: DeletePropertyDefinitionArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/definitions/${args.definition_id}`,
      {
        method: 'DELETE',
      }
    );

    return result.map(() => ({ success: true }));
  },

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

  setEntityProperty: async (args: SetEntityPropertyArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/${args.property_id}`;

    const result = await propertiesFetch<{}>(url, {
      method: 'PUT',
      body: JSON.stringify(args.body),
    });

    return result.map(() => ({ success: true }));
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

  getPropertyOptions: async (args: GetPropertyOptionsArgs) => {
    return await propertiesFetch<PropertyOption[]>(
      `/properties/definitions/${args.definition_id}/options`,
      {
        method: 'GET',
      }
    );
  },

  addPropertyOption: async (args: AddPropertyOptionArgs) => {
    return await propertiesFetch<PropertyOption>(
      `/properties/definitions/${args.definition_id}/options`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
      }
    );
  },

  deletePropertyOption: async (args: DeletePropertyOptionArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/definitions/${args.definition_id}/options/${args.option_id}`,
      {
        method: 'DELETE',
      }
    );

    return result.map(() => ({ success: true }));
  },

  setPropertyStatusComplete: async (args: SetPropertyStatusCompleteArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/status/complete`;
    const result = await propertiesFetch<{}>(url, {
      method: 'PATCH',
    });
    return result.map(() => ({ success: true }));
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
