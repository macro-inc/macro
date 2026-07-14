import { storageServiceClient } from '@service-storage/client';
import type { SerializedEditorState } from 'lexical';
import { queryClient } from '../client';
import { snippetRawKeys } from './keys';

type SnippetRawArgs = {
  documentId: string;
};

function snippetRawQueryOptions(args: SnippetRawArgs) {
  return {
    queryKey: snippetRawKeys.document(args.documentId).queryKey,
    queryFn: () => storageServiceClient.getSnippetRaw(args),
    staleTime: 60 * 1000,
  };
}

export function fetchSnippetRaw(
  args: SnippetRawArgs
): Promise<SerializedEditorState> {
  return queryClient.fetchQuery(snippetRawQueryOptions(args));
}
