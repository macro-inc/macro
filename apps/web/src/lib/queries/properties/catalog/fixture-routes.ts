/**
 * Browser fixtures only: answers the catalog's GraphQL reads from REST-shaped
 * seeds, so a fixture keeps describing its data the way callers see it.
 * Requests a seed does not cover pass through, so seeds can be layered.
 */
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyDefinitionWithOptions } from '@service-properties/generated/schemas/propertyDefinitionWithOptions';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { PropertyOptionValue } from '@service-properties/generated/schemas/propertyOptionValue';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type {
  PropertyCatalogDefinitionFieldsFragment,
  PropertyCatalogOptionFieldsFragment,
  PropertyCatalogTagSetFieldsFragment,
} from '@service-storage/graphql/generated/graphql';

type Owner = PropertyCatalogDefinitionFieldsFragment['owner'];

function ownerRecord(owner: PropertyDefinition['owner']): Owner {
  switch (owner.scope) {
    case 'system':
      return { scope: 'SYSTEM', principalId: null };
    case 'user':
      return { scope: 'USER', principalId: owner.user_id };
    case 'team':
      return { scope: 'TEAM', principalId: owner.team_id };
    default:
      return { scope: 'DATABASE', principalId: owner.database_id };
  }
}

function valueRecord(
  value: PropertyOptionValue
): PropertyCatalogOptionFieldsFragment['value'] {
  return value.type === 'number'
    ? {
        __typename: 'GraphqlNumberPropertyOptionValue',
        numberValue: Number(value.value),
      }
    : {
        __typename: 'GraphqlStringPropertyOptionValue',
        stringValue: String(value.value),
      };
}

export function optionRecord(
  option: PropertyOption | PropertyOptionResponse
): PropertyCatalogOptionFieldsFragment {
  const rest = 'property_definition_id' in option;
  return {
    __typename: 'GraphqlPropertyOption',
    id: option.id,
    propertyDefinitionId: rest
      ? option.property_definition_id
      : option.propertyDefinitionId,
    displayOrder: rest ? option.display_order : option.displayOrder,
    value: valueRecord(option.value),
    color: option.color ?? null,
    createdAt: (rest && option.created_at) || new Date(0).toISOString(),
    updatedAt: (rest && option.updated_at) || new Date(0).toISOString(),
  };
}

export function definitionRecord(
  definition: PropertyDefinition
): PropertyCatalogDefinitionFieldsFragment {
  return {
    __typename: 'GraphqlPropertyDefinition',
    id: definition.id,
    owner: ownerRecord(definition.owner),
    displayName: definition.display_name,
    dataType: definition.data_type,
    isMultiSelect: definition.is_multi_select,
    specificEntityType: definition.specific_entity_type ?? null,
    isSystem: definition.is_system,
    isMetadata: definition.is_metadata,
    createdAt: definition.created_at || new Date(0).toISOString(),
    updatedAt: definition.updated_at || new Date(0).toISOString(),
  } as PropertyCatalogDefinitionFieldsFragment;
}

export function tagSetRecord(
  set: TagSetResponse
): PropertyCatalogTagSetFieldsFragment {
  const definition = set.definition;
  return {
    scope: set.scope === 'team' ? 'TEAM' : 'USER',
    definition: definition
      ? ({
          __typename: 'GraphqlPropertyDefinition',
          id: definition.id,
          owner: ownerRecord(definition),
          displayName: definition.displayName,
          dataType: definition.dataType,
          isMultiSelect: definition.isMultiSelect,
          specificEntityType: definition.specificEntityType ?? null,
          isSystem: definition.isSystem,
          isMetadata: definition.isMetadata,
          createdAt: definition.createdAt ?? new Date(0).toISOString(),
          updatedAt: definition.updatedAt ?? new Date(0).toISOString(),
        } as PropertyCatalogDefinitionFieldsFragment)
      : null,
    options: set.options.map(optionRecord),
  };
}

export type CatalogSeed = {
  /** The viewer the answers belong to. */
  userId: string;
  definitions?: PropertyDefinitionWithOptions[];
  /** Options by definition id, for definitions not listed above. */
  options?: Record<string, PropertyOption[]>;
  tagSets?: TagSetResponse[];
};

const OWNER_SCOPE: Record<string, Owner['scope'] | undefined> = {
  SYSTEM: 'SYSTEM',
  USER: 'USER',
  TEAM: 'TEAM',
};

/** Answer catalog reads from `seed`; returns the restore function. */
export function routeCatalogQueries(seed: CatalogSeed): () => void {
  const nativeFetch = window.fetch;
  const user = { id: seed.userId };
  const definitions = seed.definitions ?? [];
  const seededOptions = (id: string) =>
    (
      definitions.find((item) => item.definition.id === id)?.property_options ??
      seed.options?.[id]
    )?.map(optionRecord);
  const optionsOf = (id: string) => seededOptions(id) ?? [];
  const answer = (
    query: string,
    variables: Record<string, unknown>
  ): unknown | undefined => {
    if (query.includes('query PropertyCatalogTagSets')) {
      if (!seed.tagSets) return undefined;
      return {
        user: { ...user, tagSets: (seed.tagSets ?? []).map(tagSetRecord) },
      };
    }
    if (query.includes('query PropertyCatalogOptions')) {
      const options = seededOptions(String(variables.propertyDefinitionId));
      return options && { user: { ...user, propertyOptions: options } };
    }
    if (
      !seed.definitions ||
      !query.includes('query PropertyCatalogDefinitions')
    )
      return undefined;
    const scope = OWNER_SCOPE[String(variables.scope)];
    const withOptions = query.includes('PropertyCatalogDefinitionsWithOptions');
    return {
      user: {
        ...user,
        propertyDefinitions: definitions
          .map((item) => definitionRecord(item.definition))
          .filter((record) => !scope || record.owner.scope === scope)
          .map((record) =>
            withOptions ? { ...record, options: optionsOf(record.id) } : record
          ),
      },
    };
  };
  window.fetch = async (input, init) => {
    if (String(input).includes('/graphql') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      const data = body.query && answer(body.query, body.variables ?? {});
      if (data) {
        return new Response(JSON.stringify({ data }), {
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return nativeFetch(input, init);
  };
  return () => {
    window.fetch = nativeFetch;
  };
}
