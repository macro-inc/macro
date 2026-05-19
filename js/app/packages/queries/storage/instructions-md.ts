import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  getTextContent,
  initializeEditorWithState,
} from '@core/component/LexicalMarkdown/utils';

import { storageServiceClient } from '@service-storage/client';
import { syncServiceClient } from '@service-sync/client';
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

const getInstructionsMdText = async (id: string | null | undefined) => {
  if (!id) {
    return null;
  }

  const rawState = await syncServiceClient.getRaw({
    documentId: id,
  });

  const { editor } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'instructions-md-text-extractor',
    isInteractable: () => false,
  });

  initializeEditorWithState(editor, rawState);

  const plaintext = getTextContent(editor);

  return plaintext;
};

/** useQuery hook for retrieving the instructions md document text content */
export function useInstructionsMdTextQuery() {
  const idQuery = useInstructionsMdIdQuery();

  return useQuery(() => {
    const id = idQuery.data;
    return {
      // Use a placeholder key when id is null/undefined - query is disabled anyway
      queryKey: id
        ? instructionsMdKeys.text(id).queryKey
        : ['instructionsMd', 'text', null],
      queryFn: () => getInstructionsMdText(id),
      enabled: idQuery.isSuccess && !!id,
      staleTime: Infinity,
      throwOnError: false,
      retry: false,
      retryOnMount: false,
    };
  });
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

/** Hook to get a function that updates the instructions text in the query cache */
export function useUpdateInstructionsMdTextCache() {
  const idQuery = useInstructionsMdIdQuery();

  return (text: string) => {
    const id = idQuery.data;
    if (id) {
      queryClient.setQueryData(instructionsMdKeys.text(id).queryKey, text);
    }
  };
}
