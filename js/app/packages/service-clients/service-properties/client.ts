import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { z } from 'zod';
import type * as schemas from './generated/zod';

type PropertiesEntityType = z.infer<
  typeof schemas.setEntityPropertyParams.shape.entity_type
>;

type ListPropertiesArgs = z.infer<typeof schemas.listPropertiesQueryParams>;
type CreatePropertyDefinitionArgs = {
  body: z.infer<typeof schemas.createPropertyDefinitionBody>;
};
type DeletePropertyDefinitionArgs = z.infer<
  typeof schemas.deletePropertyDefinitionParams
>;
type GetEntityPropertiesArgs = z.infer<
  typeof schemas.getEntityPropertiesParams
> & {
  query: z.infer<typeof schemas.getEntityPropertiesQueryParams>;
};
type SetEntityPropertyArgs = z.infer<typeof schemas.setEntityPropertyParams> & {
  body: z.infer<typeof schemas.setEntityPropertyBody>;
};
type DeleteEntityPropertyArgs = z.infer<
  typeof schemas.deleteEntityPropertyParams
>;
type GetPropertyOptionsArgs = z.infer<typeof schemas.getPropertyOptionsParams>;
type AddPropertyOptionArgs = z.infer<typeof schemas.addPropertyOptionParams> & {
  body: z.infer<typeof schemas.addPropertyOptionBody>;
};
type DeletePropertyOptionArgs = z.infer<
  typeof schemas.deletePropertyOptionParams
>;
type SetPropertyStatusCompleteArgs = {
  entity_type: PropertiesEntityType;
  entity_id: string;
};

const propertiesHost: string = SERVER_HOSTS['properties-service'];

export function propertiesFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function propertiesFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function propertiesFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${propertiesHost}${url}`, init);
}

export const propertiesServiceClient = {
  listProperties: async (args: ListPropertiesArgs) => {
    const queryParams = new URLSearchParams();
    queryParams.set('scope', args.scope);
    if (args.include_options !== undefined) {
      queryParams.set('include_options', String(args.include_options));
    }

    return await propertiesFetch<
      z.infer<typeof schemas.listPropertiesResponse>
    >(`/properties/definitions?${queryParams}`, {
      method: 'GET',
    });
  },

  createPropertyDefinition: async (args: CreatePropertyDefinitionArgs) => {
    return await propertiesFetch<{
      created_at: string;
      data_type:
        | 'boolean'
        | 'date'
        | 'number'
        | 'string'
        | 'select_number'
        | 'select_string'
        | 'entity';
      display_name: string;
      id: string;
      is_metadata: boolean;
      is_multi_select: boolean;
      owner:
        | { scope: 'user'; user_id: string }
        | { scope: 'organization'; organization_id: number }
        | {
            scope: 'user_and_organization';
            user_id: string;
            organization_id: number;
          };
      specific_entity_type?:
        | 'channel'
        | 'chat'
        | 'document'
        | 'project'
        | 'thread'
        | 'user'
        | null;
      updated_at: string;
    }>(`/properties/definitions`, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  deletePropertyDefinition: async (args: DeletePropertyDefinitionArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/definitions/${args.definition_id}`,
      {
        method: 'DELETE',
      }
    );

    return mapOk(result, () => ({ success: true }));
  },

  getEntityProperties: async (args: GetEntityPropertiesArgs) => {
    const queryParams = new URLSearchParams();

    if (args.query.include_metadata !== undefined) {
      queryParams.set('include_metadata', String(args.query.include_metadata));
    }

    const queryString = queryParams.toString();
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}${queryString ? `?${queryString}` : ''}`;

    return await propertiesFetch<
      z.infer<typeof schemas.getEntityPropertiesResponse>
    >(url, {
      method: 'GET',
    });
  },

  setEntityProperty: async (args: SetEntityPropertyArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/${args.property_id}`;

    const result = await propertiesFetch<{}>(url, {
      method: 'PUT',
      body: JSON.stringify(args.body),
    });

    return mapOk(result, () => ({ success: true }));
  },

  deleteEntityProperty: async (args: DeleteEntityPropertyArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/entity_properties/${args.entity_property_id}`,
      {
        method: 'DELETE',
      }
    );

    return mapOk(result, () => ({ success: true }));
  },

  getPropertyOptions: async (args: GetPropertyOptionsArgs) => {
    return await propertiesFetch<
      z.infer<typeof schemas.getPropertyOptionsResponse>
    >(`/properties/definitions/${args.definition_id}/options`, {
      method: 'GET',
    });
  },

  addPropertyOption: async (args: AddPropertyOptionArgs) => {
    return await propertiesFetch<{
      created_at: string;
      display_order: number;
      id: string;
      property_definition_id: string;
      updated_at: string;
      value:
        | { type: 'string'; value: string }
        | { type: 'number'; value: number };
    }>(`/properties/definitions/${args.definition_id}/options`, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  deletePropertyOption: async (args: DeletePropertyOptionArgs) => {
    const result = await propertiesFetch<{}>(
      `/properties/definitions/${args.definition_id}/options/${args.option_id}`,
      {
        method: 'DELETE',
      }
    );

    return mapOk(result, () => ({ success: true }));
  },

  setPropertyStatusComplete: async (args: SetPropertyStatusCompleteArgs) => {
    const url = `/properties/entities/${args.entity_type}/${args.entity_id}/status/complete`;
    const result = await propertiesFetch<{}>(url, {
      method: 'PATCH',
    });
    return mapOk(result, () => ({ success: true }));
  },
};

registerClient('properties', propertiesServiceClient);
