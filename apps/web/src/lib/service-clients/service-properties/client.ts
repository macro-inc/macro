import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { registerClient } from '@core/util/mockClient';
import type { ObjectLike, ResultError } from '@core/util/result';
import { ThrownResultError } from '@core/util/result';
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
import type { MergeTagRequest } from './generated/schemas/mergeTagRequest';
import type { PromoteTagRequest } from './generated/schemas/promoteTagRequest';
import type { PropertyDefinition } from './generated/schemas/propertyDefinition';
import type { PropertyDefinitionResponse } from './generated/schemas/propertyDefinitionResponse';
import type { PropertyOption } from './generated/schemas/propertyOption';
import type { PropertyOptionResponse } from './generated/schemas/propertyOptionResponse';
import type { PropertyTargetEntityType } from './generated/schemas/propertyTargetEntityType';
import type { SetEntityPropertyRequest } from './generated/schemas/setEntityPropertyRequest';
import type { TagPromotionConflictResponse } from './generated/schemas/tagPromotionConflictResponse';
import type { TagSetResponse } from './generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from './generated/schemas/updatePropertyOptionRequest';

type PropertiesEntityType = PropertyTargetEntityType;

/**
 * A promote-tag call rejected because the team already owns a label with that
 * name. The colliding label rides along on the error so the caller can prompt
 * with it and then merge into it.
 */
export const TAG_NAME_CONFLICT_CODE = 'TAG_NAME_CONFLICT' as const;

type TagPromoteErrorCode = typeof TAG_NAME_CONFLICT_CODE;

/** safeFetch's default mapping for statuses the custom handler doesn't claim. */
function defaultFetchError(response: Response) {
  switch (response.status) {
    case 401:
      return { code: 'UNAUTHORIZED' as const, message: 'Unauthorized access' };
    case 403:
      return { code: 'FORBIDDEN' as const, message: 'Forbidden' };
    case 404:
      return { code: 'NOT_FOUND' as const, message: 'Resource not found' };
    default:
      return {
        code: 'HTTP_ERROR' as const,
        message: `HTTP error! status: ${response.status}`,
      };
  }
}

/**
 * Recover the colliding team label from a thrown promote error, or `null` when
 * the failure was something else.
 */
export function parseTagNameConflict(
  error: unknown
): TagPromotionConflictResponse | null {
  if (!(error instanceof ThrownResultError)) return null;
  const conflict = error.errors.find(
    (candidate) => candidate.code === TAG_NAME_CONFLICT_CODE
  );
  if (!conflict) return null;

  try {
    const parsed = JSON.parse(conflict.message) as TagPromotionConflictResponse;
    return parsed.conflicting_option ? parsed : null;
  } catch {
    return null;
  }
}

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
type PromoteTagArgs = {
  body: PromoteTagRequest;
};
type MergeTagArgs = {
  body: MergeTagRequest;
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

  /**
   * Share a personal label with the caller's team, keeping its option id so
   * everything already tagged stays tagged.
   *
   * A 409 means the team already has a label with that name. The default
   * safeFetch mapping would collapse that to a bare `CONFLICT` and drop the
   * body, so a custom handler carries the colliding label through as JSON for
   * the caller to prompt with (see `parseTagNameConflict`).
   */
  promoteTag: async (args: PromoteTagArgs) => {
    return await fetchWithToken<PropertyOptionResponse, TagPromoteErrorCode>(
      `${propertiesHost}/properties/tags/promote`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
        errorResponseHandler: async (response) => {
          if (response.status === 409) {
            const body = (await response
              .json()
              .catch(() => null)) as TagPromotionConflictResponse | null;
            if (body?.conflicting_option) {
              return {
                code: TAG_NAME_CONFLICT_CODE,
                message: JSON.stringify(body),
              };
            }
          }
          return defaultFetchError(response);
        },
      }
    );
  },

  /** Replace a personal label with an existing team label, retagging entities. */
  mergeTag: async (args: MergeTagArgs) => {
    return await propertiesFetch<PropertyOptionResponse>(
      `/properties/tags/merge`,
      {
        method: 'POST',
        body: JSON.stringify(args.body),
      }
    );
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
