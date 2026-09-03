import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { instructionsMdKeys } from './keys';

export { default as AiInstructionsIcon } from '@phosphor/notepad.svg';

/**
 * Returns the instructions md document id for the current user.
 * Returns null if not yet created, throws otherwise.
 */
const getInstructionsMdId = async (): Promise<string | null | undefined> => {
  const getResult = await storageServiceClient.instructions.get();

  if (getResult.isOk()) {
    const { documentId } = getResult.value;
    return documentId;
  }

  const error = getResult.error;
  const [{ code }] = error;
  if (code === 'NOT_FOUND') {
    return null;
  }

  console.error('Error getting instructionsMdId', error);
  throw new Error('Error getting instructionsMdId');
};

function instructionsMdIdQueryOptions() {
  return {
    queryKey: instructionsMdKeys.id.queryKey,
    queryFn: getInstructionsMdId,
    staleTime: Infinity,
    throwOnError: false,
    retry: false,
    retryOnMount: false,
  };
}

/**
 * useQuery hook for retrieving the instructions md document id.
 * Returns null if not yet created, throws otherwise.
 */
export function useInstructionsMdIdQuery() {
  return useQuery(() => instructionsMdIdQueryOptions());
}

/** Creates the instructions md document. Backend prevents duplicates */
export function useCreateInstructionsMd() {
  return async () => {
    const createResult = await storageServiceClient.instructions.create();
    if (createResult.isOk()) {
      const { documentId } = createResult.value;
      queryClient.setQueryData(instructionsMdKeys.id.queryKey, documentId);
      return documentId;
    }
  };
}
