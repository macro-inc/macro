import { queryClient } from '@queries/client';
import { useMutationState } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import type { EntityData } from '../../entity/types/entity';
import type { EntityAppearance } from '../core/appearance';

export const ENTITY_APPEARANCE_MUTATION_KEY = [
  'entity-appearance',
  'save',
] as const;

export type AppearanceMutationVariables = {
  entity: EntityData;
  appearance: EntityAppearance;
  isCurrent: () => boolean;
  retainAfterSave?: boolean;
};

/** Pending intent only; saved appearance remains owned by the entity readers. */
export function usePendingEntityAppearance() {
  const mutations = useMutationState(
    () => ({
      filters: { mutationKey: ENTITY_APPEARANCE_MUTATION_KEY },
      select: (mutation) => ({
        variables: mutation.state.variables as AppearanceMutationVariables,
        status: mutation.state.status,
      }),
    }),
    () => queryClient
  );
  const pending = createMemo(() => {
    const values = new Map<
      string,
      { appearance: EntityAppearance; confirmed: boolean }
    >();
    for (const { variables, status } of mutations()) {
      if (
        variables?.isCurrent() &&
        (status === 'pending' ||
          (status === 'success' && variables.retainAfterSave))
      ) {
        values.set(`${variables.entity.type}:${variables.entity.id}`, {
          appearance: variables.appearance,
          confirmed: status === 'success',
        });
      }
    }
    return values;
  });
  return (type: string, id: string, failedRead = false) => {
    const value = pending().get(`${type}:${id}`);
    return value && (!value.confirmed || failedRead)
      ? value.appearance
      : undefined;
  };
}
