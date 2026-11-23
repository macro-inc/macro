import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { queryAccountSession } from '@queries/auth/account-scope';
import type { EnsureTagSetRequest } from '@service-properties/generated/schemas/ensureTagSetRequest';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagPromotionConflictResponse } from '@service-properties/generated/schemas/tagPromotionConflictResponse';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from '@service-properties/generated/schemas/updatePropertyOptionRequest';
import { PropertyCatalogTagSetsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type CatalogListResult,
  catalogListResult,
  createListedAt,
} from './catalog/list-result';
import { toTagSet } from './catalog/map';
import {
  type CatalogMutationCallbacks,
  createCatalogMutation,
} from './catalog/mutation';
import { registerCatalogReader } from './catalog/readers';
import {
  addPropertyOption,
  cachedTagSet,
  deletePropertyOption,
  ensureTagSet,
  isCatalogErrorCode,
  mergeTag,
  promoteTag,
  refreshPropertyCatalog,
  refreshTagSets,
  TagNameConflictError,
  updatePropertyOption,
} from './catalog/writes';

const EMPTY_TAG_SETS: TagSetResponse[] = [];

/** The caller's tag sets: their personal set, plus their team's set when on a team. */
export function useTagsQuery(): CatalogListResult<TagSetResponse> {
  const isAuthenticated = useIsAuthenticated();
  const variables = () => (isAuthenticated() === true ? {} : undefined);
  const stamp = createListedAt(PropertyCatalogTagSetsDocument, variables);
  const query = createLiveQuery(
    PropertyCatalogTagSetsDocument,
    variables,
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) => data.user.tagSets.flatMap((set) => toTagSet(set) ?? []),
      onResult: stamp.onResult,
    })
  );
  registerCatalogReader({
    kind: 'tags',
    definitions: () =>
      (query.data ?? []).flatMap((set) =>
        set.definition
          ? [
              {
                scope: set.scope === 'team' ? 'TEAM' : 'USER',
                definitionId: set.definition.id,
              } as const,
            ]
          : []
      ),
    refresh: () => query.refetch({ requestPolicy: 'network-only' }),
  });
  return catalogListResult(query, stamp, EMPTY_TAG_SETS);
}

/** Reload the tag sets on screen from the server. */
export function invalidateTags() {
  refreshTagSets();
}

/**
 * Reload every catalog list on screen and the cached entity values. For
 * backend-originated bulk changes (signup seeding applies tags and priorities
 * server-side) that no client write described.
 */
export function invalidateAllProperties() {
  return refreshPropertyCatalog();
}

/**
 * Recover the colliding team label from a failed share, or `null` when the
 * failure was something else.
 */
export function parseTagNameConflict(
  error: unknown
): TagPromotionConflictResponse | null {
  return error instanceof TagNameConflictError
    ? { message: error.message, conflicting_option: error.conflictingOption }
    : null;
}

type EnsureTagSetParams = { scope: EnsureTagSetRequest['scope'] };

const quietEnsureFailure = (error: unknown) =>
  ['UNAUTHORIZED', 'UNAUTHENTICATED', 'FORBIDDEN'].some((code) =>
    isCatalogErrorCode(error, code)
  );

/**
 * Provision (get-or-create) the caller's tag definition for a scope. A set the
 * cache already holds as provisioned answers at once, offline included.
 */
async function provisionTagSet(scope: EnsureTagSetParams['scope']) {
  return (await cachedTagSet(scope)) ?? (await ensureTagSet(scope));
}

export function useEnsureTagSetMutation(
  callbacks?: CatalogMutationCallbacks<TagSetResponse, EnsureTagSetParams>
) {
  return createCatalogMutation(
    (vars: EnsureTagSetParams) => provisionTagSet(vars.scope),
    {
      onError(error) {
        if (quietEnsureFailure(error)) return;
        console.error('Failed to provision tag set', error);
        toast.failure('Failed to set up tags');
      },
    },
    callbacks
  );
}

type UpdatePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
  body: UpdatePropertyOptionRequest;
};

const updateLabelFailed = () => toast.failure('Failed to update label');

/** Rename / recolor a label in place. The option id is preserved so the change propagates. */
export function useUpdatePropertyOptionMutation(
  callbacks?: CatalogMutationCallbacks<void, UpdatePropertyOptionParams>
) {
  return createCatalogMutation(
    (vars: UpdatePropertyOptionParams) =>
      updatePropertyOption(
        vars.propertyDefinitionId,
        vars.optionId,
        vars.body,
        updateLabelFailed
      ),
    {
      onError(error) {
        console.error('Failed to update label', error);
        updateLabelFailed();
      },
    },
    callbacks
  );
}

type CreateTagParams = {
  scope: EnsureTagSetRequest['scope'];
  value: string;
  color?: string;
};

export type CreateTagResult = {
  scope: EnsureTagSetRequest['scope'];
  tagSet: TagSetResponse;
  option: PropertyOption;
};

/** The next display order after a set's options: new tags go last. */
export function nextTagDisplayOrder(set: Pick<TagSetResponse, 'options'>) {
  return (
    set.options.reduce(
      (max, option) => Math.max(max, option.displayOrder),
      -1
    ) + 1
  );
}

const createTagFailed = () => toast.failure('Failed to create tag');

/**
 * Create a tag in the caller's personal or team set. Resolves with the tag
 * once the server has it.
 */
export async function createTag(
  vars: CreateTagParams
): Promise<CreateTagResult> {
  const session = queryAccountSession();
  const tagSet = await provisionTagSet(vars.scope);
  const definition = tagSet.definition;
  if (!definition) {
    throw new Error(`Tag set for scope "${vars.scope}" has no definition`);
  }
  const option = await addPropertyOption(
    definition.id,
    {
      type: 'select_string',
      option: {
        value: vars.value,
        color: vars.color,
        display_order: nextTagDisplayOrder(tagSet),
      },
    },
    { session }
  );
  return { scope: vars.scope, tagSet, option };
}

export function useCreateTagMutation(
  callbacks?: CatalogMutationCallbacks<CreateTagResult, CreateTagParams>
) {
  return createCatalogMutation(
    createTag,
    {
      onError(error) {
        console.error('Failed to create tag', error);
        createTagFailed();
      },
    },
    callbacks
  );
}

type DeletePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
};

const deleteLabelFailed = () => toast.failure('Failed to delete label');

/** Delete a label. */
export function useDeletePropertyOptionMutation(
  callbacks?: CatalogMutationCallbacks<void, DeletePropertyOptionParams>
) {
  return createCatalogMutation(
    (vars: DeletePropertyOptionParams) =>
      deletePropertyOption(
        vars.propertyDefinitionId,
        vars.optionId,
        deleteLabelFailed
      ),
    {
      onError(error) {
        console.error('Failed to delete label', error);
        deleteLabelFailed();
      },
    },
    callbacks
  );
}

type PromoteTagParams = {
  /** The personal label being shared with the team. */
  optionId: string;
};

/**
 * Share a personal label with the caller's team.
 *
 * The option id survives the move, so entities already carrying the label keep
 * it — only its owning definition changes. Fails with a conflict carrying the
 * colliding team label when the team already has one by that name; read it
 * with `parseTagNameConflict` and offer {@link useMergeTagMutation} instead.
 */
export function usePromoteTagMutation(
  callbacks?: CatalogMutationCallbacks<PropertyOptionResponse, PromoteTagParams>
) {
  return createCatalogMutation(
    (vars: PromoteTagParams) => promoteTag(vars.optionId),
    {
      onError(error) {
        // A name collision is a prompt, not a failure — the caller turns it
        // into the "replace with the team label?" confirmation.
        if (parseTagNameConflict(error)) return;
        console.error('Failed to share label with team', error);
        toast.failure('Failed to share label with team');
      },
    },
    callbacks
  );
}

type MergeTagParams = {
  /** The personal label being retired. */
  optionId: string;
  /** The team label its entities are retagged with. */
  targetOptionId: string;
};

/**
 * Replace a personal label with an existing team label, retagging everything
 * that carried the personal one. The team label's name and color win.
 */
export function useMergeTagMutation(
  callbacks?: CatalogMutationCallbacks<PropertyOptionResponse, MergeTagParams>
) {
  return createCatalogMutation(
    (vars: MergeTagParams) => mergeTag(vars.optionId, vars.targetOptionId),
    {
      onError(error) {
        console.error('Failed to replace label with the team label', error);
        toast.failure('Failed to replace label');
      },
    },
    callbacks
  );
}
