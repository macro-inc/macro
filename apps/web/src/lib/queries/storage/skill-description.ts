import { storageServiceClient } from '@service-storage/client';
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';

const MAX_CHARS = 300;
const OPENING = 'use when ';

/**
 * Why `text` is not a valid skill description, or undefined when it is. The
 * storage service applies the same rules: one line, at most 300 characters,
 * starting "Use when".
 */
export function skillDescriptionProblem(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return 'Describe when to use the skill, starting "Use when".';
  if (/[\r\n]/.test(trimmed)) return 'Keep the description to one line.';
  if (trimmed.length > MAX_CHARS)
    return `Keep the description to ${MAX_CHARS} characters or fewer.`;
  if (!trimmed.toLowerCase().startsWith(OPENING))
    return 'Start the description with "Use when".';
  return undefined;
}

const skillDescriptionKey = (documentId: string) =>
  ['storage', 'skill-description', documentId] as const;

async function fetchSkillDescription(documentId: string) {
  const result = await storageServiceClient.getSkillDescription({ documentId });
  if (result.isErr()) throw new Error('Failed to load skill description');
  return result.value.description ?? undefined;
}

async function saveSkillDescription(documentId: string, description: string) {
  const result = await storageServiceClient.setSkillDescription({
    documentId,
    description,
  });
  if (result.isErr())
    throw new Error(
      result.error[0]?.message ?? 'Failed to save skill description'
    );
  return result.value.description ?? undefined;
}

/** Query options for when to use the skill `documentId`. */
export function skillDescriptionQueryOptions(documentId: string) {
  return {
    queryKey: skillDescriptionKey(documentId),
    queryFn: () => fetchSkillDescription(documentId),
  };
}

/** When to use a skill: agents load it for requests this describes. */
export function useSkillDescriptionQuery(documentId: () => string) {
  return useQuery(() => skillDescriptionQueryOptions(documentId()));
}

function setSkillDescriptionMutationOptions(
  documentId: string,
  queryClient: QueryClient
) {
  return {
    mutationFn: (description: string) =>
      saveSkillDescription(documentId, description),
    onSuccess: (description: string | undefined) =>
      queryClient.setQueryData(skillDescriptionKey(documentId), description),
  };
}

/** Save when to use a skill. Rejects with the server's message when invalid. */
export function useSetSkillDescription(documentId: () => string) {
  const queryClient = useQueryClient();
  return useMutation(() =>
    setSkillDescriptionMutationOptions(documentId(), queryClient)
  );
}
