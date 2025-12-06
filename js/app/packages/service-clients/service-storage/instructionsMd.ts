import { MARKDOWN_LORO_SCHEMA } from '@block-md/definition';
import { rawStateToLoroSnapshot } from '@core/collab/utils';
import { createMarkdownStateFromContent } from '@core/component/LexicalMarkdown/collaboration/utils';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  getTextContent,
  initializeEditorWithState,
} from '@core/component/LexicalMarkdown/utils';
import { isOk } from '@core/util/maybeResult';
import { QueryClient, useQuery } from '@tanstack/solid-query';
import { syncServiceClient } from '../service-sync/client';
import { storageServiceClient } from './client';

export { default as AiInstructionsIcon } from '@icon/regular/notepad.svg';

const queryClient = new QueryClient();

/**
 *  Returns the instructions md document id for the current user.
 *  Returns null if not yet created, throws otherwise.
 */
const getInstructionsMdId = async (): Promise<string | null | undefined> => {
  const getResult = await storageServiceClient.instructions.get();

  if (isOk(getResult)) {
    const [, { documentId }] = getResult;
    return documentId;
  }

  const [error] = getResult;
  const [{ code }] = error;
  if (code === 'NOT_FOUND') {
    return null;
  }

  console.error('Error getting instructionsMdId', error);
  throw new Error('Error getting instructionsMdId');
};

/** Creates the instructions md document. Backend prevents duplicates */
export const useCreateInstructionsMd = () => {
  return async () => {
    const emptyMarkdownState = await createMarkdownStateFromContent(undefined);
    const snapshot = await rawStateToLoroSnapshot(
      MARKDOWN_LORO_SCHEMA,
      emptyMarkdownState as any
    );
    if (!snapshot) return;
    const createResult = await storageServiceClient.instructions.create();
    if (isOk(createResult)) {
      const [, { documentId }] = createResult;
      let res = await syncServiceClient.initializeFromSnapshot({
        snapshot,
        documentId: documentId,
      });
      if (!isOk(res)) {
        console.error(
          'Failed to initialize instructions document from snapshot'
        );
        return;
      }
      queryClient.setQueryData(['instructionsMdId'], documentId);
      return documentId;
    }
  };
};

const getInstructionsMdText = async (id: string | null | undefined) => {
  if (!id) {
    return null;
  }

  const rawState = await syncServiceClient.getRaw({
    documentId: id,
  });

  // Create lexical editor with raw JSON state
  const { editor } = createLexicalWrapper({
    // this should be plain-text but there might be edge cases so we don't want to throw
    type: 'markdown',
    namespace: 'instructions-md-text-extractor',
    isInteractable: () => false,
  });

  initializeEditorWithState(editor, rawState);

  const plaintext = getTextContent(editor);

  return plaintext;
};

/** useQuery hook for retrieving the instructions md document id
 *  returns null if not yet created, throws otherwise.
 */
export function useInstructionsMdIdQuery() {
  const query = useQuery(
    () => ({
      queryKey: ['instructionsMdId'],
      queryFn: getInstructionsMdId,
      staleTime: Infinity,
      throwOnError: false,
      retry: false,
      retryOnMount: false,
    }),
    () => queryClient
  );
  return query;
}

/** useQuery hook for retrieving the instructions md document text content */
export function useInstructionsMdTextQuery() {
  const idQuery = useInstructionsMdIdQuery();

  const query = useQuery(
    () => ({
      queryKey: ['instructionsMdText', idQuery.data],
      queryFn: () => getInstructionsMdText(idQuery.data),
      enabled: idQuery.isSuccess && !!idQuery.data,
      staleTime: Infinity,
      throwOnError: false,
      retry: false,
      retryOnMount: false,
    }),
    () => queryClient
  );

  return query;
}

/** Hook to get a function that updates the instructions text in the query cache */
export function useUpdateInstructionsMdTextCache() {
  const idQuery = useInstructionsMdIdQuery();

  return (text: string) => {
    const id = idQuery.data;
    if (id) {
      queryClient.setQueryData(['instructionsMdText', id], text);
    }
  };
}
