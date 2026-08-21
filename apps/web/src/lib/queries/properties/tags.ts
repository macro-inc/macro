import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import {
  parseTagNameConflict,
  propertiesServiceClient,
} from '../../service-clients/service-properties/client';
import type { AddPropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/addPropertyOptionRequest';
import type { EnsureTagSetRequest } from '../../service-clients/service-properties/generated/schemas/ensureTagSetRequest';
import type { PropertyOption } from '../../service-clients/service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '../../service-clients/service-properties/generated/schemas/propertyOptionResponse';
import type { TagSetResponse } from '../../service-clients/service-properties/generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from '../../service-clients/service-properties/generated/schemas/updatePropertyOptionRequest';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

const EMPTY_TAG_SETS: TagSetResponse[] = [];

/** The caller's tag sets: their personal set, plus their team's set when on a team. */
export function useTagsQuery() {
  const isAuthenticated = useIsAuthenticated();
  return useQuery(() => ({
    queryKey: propertiesKeys.tags.queryKey,
    queryFn: async () =>
      await throwOnErr(async () => await propertiesServiceClient.listTags()),
    staleTime: 1000 * 60 * 5,
    enabled: isAuthenticated() === true,
    placeholderData: EMPTY_TAG_SETS,
  }));
}

export function invalidateTags() {
  queryClient.invalidateQueries({ queryKey: propertiesKeys.tags.queryKey });
}

/**
 * Invalidate the whole properties namespace — tag sets, definitions, options,
 * and cached entity values. For backend-originated bulk changes (signup
 * seeding applies tags and priorities server-side) where per-key invalidation
 * would have to enumerate ids the client doesn't know.
 */
export function invalidateAllProperties() {
  queryClient.invalidateQueries({ queryKey: propertiesKeys._def });
}

function invalidatePropertyOptions(propertyDefinitionId: string) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.options({ propertyDefinitionId }).queryKey,
  });
}

function propertyOptionToResponse(
  option: PropertyOption
): PropertyOptionResponse {
  return {
    id: option.id,
    propertyDefinitionId: option.property_definition_id,
    displayOrder: option.display_order,
    value: option.value,
    color: option.color,
  };
}

function updateTagsCache(update: (sets: TagSetResponse[]) => TagSetResponse[]) {
  queryClient.setQueryData<TagSetResponse[]>(
    propertiesKeys.tags.queryKey,
    (current) => (current ? update(current) : current)
  );
}

type EnsureTagSetParams = { scope: EnsureTagSetRequest['scope'] };

/** Provision (get-or-create) the caller's tag definition for a scope. */
export function useEnsureTagSetMutation(
  callbacks?: MutationCallbacks<TagSetResponse, Error, EnsureTagSetParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: EnsureTagSetParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.ensureTagSet({
            body: { scope: vars.scope },
          })
      ),
    ...withCallbacks<TagSetResponse, Error, EnsureTagSetParams>(
      {
        onError(error) {
          if (
            thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
            thrownResultErrorHasCode(error, 'FORBIDDEN')
          ) {
            return;
          }
          console.error('Failed to provision tag set', error);
          toast.failure('Failed to set up tags');
        },
        onSuccess: () => invalidateTags(),
      },
      callbacks
    ),
  }));
}

type UpdatePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
  body: UpdatePropertyOptionRequest;
};

type TagsMutationContext = {
  previousTags?: TagSetResponse[];
  optimisticOptionId?: string;
};

/** Rename / recolor a label in place. The option id is preserved so the change propagates. */
export function useUpdatePropertyOptionMutation(
  callbacks?: MutationCallbacks<
    PropertyOption,
    Error,
    UpdatePropertyOptionParams,
    TagsMutationContext
  >
) {
  return useMutation(() => ({
    onMutate: async (vars): Promise<TagsMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: propertiesKeys.tags.queryKey,
      });
      const previousTags = queryClient.getQueryData<TagSetResponse[]>(
        propertiesKeys.tags.queryKey
      );

      updateTagsCache((sets) =>
        sets.map((set) => ({
          ...set,
          options: set.options.map((option) => {
            if (
              option.id !== vars.optionId ||
              option.propertyDefinitionId !== vars.propertyDefinitionId
            ) {
              return option;
            }

            return {
              ...option,
              displayOrder: vars.body.display_order ?? option.displayOrder,
              color:
                vars.body.color === undefined ? option.color : vars.body.color,
              value:
                vars.body.value == null
                  ? option.value
                  : { type: 'string', value: vars.body.value },
            };
          }),
        }))
      );

      return { previousTags };
    },
    mutationFn: async (vars: UpdatePropertyOptionParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.updatePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
            body: vars.body,
          })
      ),
    ...withCallbacks<
      PropertyOption,
      Error,
      UpdatePropertyOptionParams,
      TagsMutationContext
    >(
      {
        onError(error, _variables, context) {
          if (context?.previousTags) {
            queryClient.setQueryData(
              propertiesKeys.tags.queryKey,
              context.previousTags
            );
          }
          console.error('Failed to update label', error);
          toast.failure('Failed to update label');
        },
        onSuccess: (data, variables) => {
          const updated = propertyOptionToResponse(data);
          updateTagsCache((sets) =>
            sets.map((set) =>
              set.definition?.id === variables.propertyDefinitionId
                ? {
                    ...set,
                    options: set.options.map((option) =>
                      option.id === variables.optionId ? updated : option
                    ),
                  }
                : set
            )
          );
          invalidatePropertyOptions(variables.propertyDefinitionId);
          invalidateTags();
        },
      },
      callbacks
    ),
  }));
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

/** Create a tag in the caller's personal or team set. */
export function useCreateTagMutation(
  callbacks?: MutationCallbacks<
    CreateTagResult,
    Error,
    CreateTagParams,
    TagsMutationContext
  >
) {
  return useMutation(() => ({
    onMutate: async (vars): Promise<TagsMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: propertiesKeys.tags.queryKey,
      });
      const previousTags = queryClient.getQueryData<TagSetResponse[]>(
        propertiesKeys.tags.queryKey
      );
      const optimisticOptionId = `optimistic-${crypto.randomUUID()}`;

      updateTagsCache((sets) =>
        sets.map((set) => {
          if (set.scope !== vars.scope || !set.definition) return set;

          return {
            ...set,
            options: [
              ...set.options,
              {
                id: optimisticOptionId,
                propertyDefinitionId: set.definition.id,
                displayOrder:
                  set.options.reduce(
                    (max, option) => Math.max(max, option.displayOrder),
                    -1
                  ) + 1,
                value: { type: 'string', value: vars.value },
                color: vars.color,
              },
            ],
          };
        })
      );

      return { previousTags, optimisticOptionId };
    },
    mutationFn: async (vars): Promise<CreateTagResult> => {
      const tagSet = await throwOnErr(
        async () =>
          await propertiesServiceClient.ensureTagSet({
            body: { scope: vars.scope },
          })
      );

      if (!tagSet.definition) {
        throw new Error(`Tag set for scope "${vars.scope}" has no definition`);
      }

      const body: AddPropertyOptionRequest = {
        type: 'select_string',
        option: {
          value: vars.value,
          color: vars.color,
          display_order:
            tagSet.options.reduce(
              (max, option) => Math.max(max, option.displayOrder),
              -1
            ) + 1,
        },
      };

      const option = await throwOnErr(
        async () =>
          await propertiesServiceClient.addPropertyOption({
            definition_id: tagSet.definition!.id,
            body,
          })
      );

      return { scope: vars.scope, tagSet, option };
    },
    ...withCallbacks<
      CreateTagResult,
      Error,
      CreateTagParams,
      TagsMutationContext
    >(
      {
        onError(error, _variables, context) {
          if (context?.previousTags) {
            queryClient.setQueryData(
              propertiesKeys.tags.queryKey,
              context.previousTags
            );
          }
          console.error('Failed to create tag', error);
          toast.failure('Failed to create tag');
        },
        onSuccess(data, _variables, context) {
          const created = propertyOptionToResponse(data.option);
          updateTagsCache((sets) => {
            const hasScope = sets.some((set) => set.scope === data.scope);
            const nextSets = hasScope
              ? sets
              : [
                  ...sets,
                  {
                    scope: data.scope,
                    definition: data.tagSet.definition,
                    options: [],
                  },
                ];

            return nextSets.map((set) => {
              if (set.scope !== data.scope) return set;

              const withoutOptimistic = context?.optimisticOptionId
                ? set.options.filter(
                    (option) => option.id !== context.optimisticOptionId
                  )
                : set.options;

              return {
                ...set,
                definition: set.definition ?? data.tagSet.definition,
                options: [...withoutOptimistic, created].sort(
                  (a, b) => a.displayOrder - b.displayOrder
                ),
              };
            });
          });

          invalidatePropertyOptions(data.option.property_definition_id);
          invalidateTags();
        },
      },
      callbacks
    ),
  }));
}

type DeletePropertyOptionParams = {
  propertyDefinitionId: string;
  optionId: string;
};

/** Delete a label. */
export function useDeletePropertyOptionMutation(
  callbacks?: MutationCallbacks<
    { success: boolean },
    Error,
    DeletePropertyOptionParams,
    TagsMutationContext
  >
) {
  return useMutation(() => ({
    onMutate: async (vars): Promise<TagsMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: propertiesKeys.tags.queryKey,
      });
      const previousTags = queryClient.getQueryData<TagSetResponse[]>(
        propertiesKeys.tags.queryKey
      );

      updateTagsCache((sets) =>
        sets.map((set) =>
          set.definition?.id === vars.propertyDefinitionId
            ? {
                ...set,
                options: set.options.filter(
                  (option) => option.id !== vars.optionId
                ),
              }
            : set
        )
      );

      return { previousTags };
    },
    mutationFn: async (vars: DeletePropertyOptionParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.deletePropertyOption({
            definition_id: vars.propertyDefinitionId,
            option_id: vars.optionId,
          })
      ),
    ...withCallbacks<
      { success: boolean },
      Error,
      DeletePropertyOptionParams,
      TagsMutationContext
    >(
      {
        onError(error, _variables, context) {
          if (context?.previousTags) {
            queryClient.setQueryData(
              propertiesKeys.tags.queryKey,
              context.previousTags
            );
          }
          console.error('Failed to delete label', error);
          toast.failure('Failed to delete label');
        },
        onSuccess: (_data, variables) => {
          invalidatePropertyOptions(variables.propertyDefinitionId);
          invalidateTags();
        },
      },
      callbacks
    ),
  }));
}

type PromoteTagParams = {
  /** The personal label being shared with the team. */
  optionId: string;
};

/**
 * Share a personal label with the caller's team.
 *
 * The option id survives the move, so entities already carrying the label keep
 * it — only its owning definition changes. Rejects with a
 * `TAG_NAME_CONFLICT` error carrying the colliding team label when the team
 * already has one by that name; read it with `parseTagNameConflict` and offer
 * {@link useMergeTagMutation} instead.
 */
export function usePromoteTagMutation(
  callbacks?: MutationCallbacks<PropertyOptionResponse, Error, PromoteTagParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: PromoteTagParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.promoteTag({
            body: { option_id: vars.optionId },
          })
      ),
    ...withCallbacks<PropertyOptionResponse, Error, PromoteTagParams>(
      {
        onError(error) {
          // A name collision is a prompt, not a failure — the caller turns it
          // into the "replace with the team label?" confirmation.
          if (parseTagNameConflict(error)) return;
          console.error('Failed to share label with team', error);
          toast.failure('Failed to share label with team');
        },
        onSuccess: (option) => onTagRemapped(option),
      },
      callbacks
    ),
  }));
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
  callbacks?: MutationCallbacks<PropertyOptionResponse, Error, MergeTagParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: MergeTagParams) =>
      await throwOnErr(
        async () =>
          await propertiesServiceClient.mergeTag({
            body: {
              option_id: vars.optionId,
              target_option_id: vars.targetOptionId,
            },
          })
      ),
    ...withCallbacks<PropertyOptionResponse, Error, MergeTagParams>(
      {
        onError(error) {
          console.error('Failed to replace label with the team label', error);
          toast.failure('Failed to replace label');
        },
        onSuccess: (option) => onTagRemapped(option),
      },
      callbacks
    ),
  }));
}

/**
 * Refresh everything a promote or merge moved.
 *
 * Both rewrite which definition owns the label AND the values stored on every
 * entity that carried it (a merge also swaps the option id), so the cached
 * entity properties behind tag chips, filters and `TagsRow` are stale too —
 * not just the tag sets. There are no WS events for this, so the whole
 * properties namespace is refetched rather than reconciled by hand.
 */
function onTagRemapped(option: PropertyOptionResponse) {
  invalidatePropertyOptions(option.propertyDefinitionId);
  invalidateAllProperties();
}
