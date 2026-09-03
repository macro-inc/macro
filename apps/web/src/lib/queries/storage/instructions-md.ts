import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  getTextContent,
  initializeEditorWithState,
} from '@core/component/LexicalMarkdown/utils';

import { syncServiceClient } from '@service-sync/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { useInstructionsMdIdQuery } from './instructions-md-id';
import { instructionsMdKeys } from './keys';

export {
  AiInstructionsIcon,
  useCreateInstructionsMd,
  useInstructionsMdIdQuery,
} from './instructions-md-id';

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
