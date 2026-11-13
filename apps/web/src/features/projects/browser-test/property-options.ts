import type { Accessor } from 'solid-js';
import { priority, status } from './collection-data';

export function usePropertyOptionsQuery(id: Accessor<string>) {
  return {
    get data() {
      return (
        [status, priority].find(
          (property) => property.propertyDefinitionId === id()
        )?.options ?? []
      );
    },
    isError: false,
    isLoading: false,
    isPlaceholderData: false,
  };
}
export function useAddPropertyOptionMutation() {
  return {
    isPending: false,
    mutateAsync: async () => {
      throw new Error('System options cannot be added');
    },
  };
}
