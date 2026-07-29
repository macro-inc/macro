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
import type { BulkUpdateEntityPropertyOptionsRequest } from './generated/schemas/bulkUpdateEntityPropertyOptionsRequest';
import type { BulkUpdateEntityPropertyOptionsResponse } from './generated/schemas/bulkUpdateEntityPropertyOptionsResponse';
import type { CreatePropertyDefinitionRequest } from './generated/schemas/createPropertyDefinitionRequest';
import type { EnsureTagSetRequest } from './generated/schemas/ensureTagSetRequest';
import type { EntityPropertiesResponse } from './generated/schemas/entityPropertiesResponse';
import type { GetBulkEntityProperties200 } from './generated/schemas/getBulkEntityProperties200';
import type { GetEntityPropertiesParams } from './generated/schemas/getEntityPropertiesParams';
import type { ListPropertiesParams } from './generated/schemas/listPropertiesParams';
import type { PropertyDefinition } from './generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from './generated/schemas/propertyDefinitionResponse';
import type { PropertyOption } from './generated/schemas/propertyOption';
import type { PropertyTargetEntityType } from './generated/schemas/propertyTargetEntityType';
import type { SetEntityPropertyRequest } from './generated/schemas/setEntityPropertyRequest';
import type { TagSetResponse } from './generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from './generated/schemas/updatePropertyOptionRequest';

type PropertiesEntityType = PropertyTargetEntityType;

type ListPropertiesArgs = ListPropertiesParams;
type CreatePropertyDefinitionArgs = {
  body: CreatePropertyDefinitionRequest;
};
type DeletePropertyDefinitionArgs = {
  definition_id: string;
};
type GetEntityPropertiesArgs = {
  entity_type: PropertyTargetEntityType;
  entity_id: string;
  query: GetEntityPropertiesParams;
};
type SetEntityPropertyArgs = {
  entity_type: PropertyTargetEntityType;
  entity_id: string;
  property_id: string;
  body: SetEntityPropertyRequest;
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
type GetBulkEntityPropertiesArgs = {
  body: BulkEntityPropertiesRequest;
};
type EnsureTagSetArgs = {
  body: EnsureTagSetRequest;
};
type UpdatePropertyOptionArgs = {
  definition_id: string;
  option_id: string;
  body: UpdatePropertyOptionRequest;
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

  getBulkEntityProperties: async (args: GetBulkEntityPropertiesArgs) => {
    return await propertiesFetch<GetBulkEntityProperties200>(
      `/properties/entities/bulk`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
      }
    );
  },

  listTags: async () => {
    return await propertiesFetch<TagSetResponse[]>(`/properties/tags`, {
      method: 'GET',
    });
  },

  ensureTagSet: async (args: EnsureTagSetArgs) => {
    return await propertiesFetch<TagSetResponse>(`/properties/tags`, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  updatePropertyOption: async (args: UpdatePropertyOptionArgs) => {
    return await propertiesFetch<PropertyOption>(
      `/properties/definitions/${args.definition_id}/options/${args.option_id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(args.body),
      }
    );
  },
};

registerClient('properties', propertiesServiceClient);

export type { PropertiesEntityType };
