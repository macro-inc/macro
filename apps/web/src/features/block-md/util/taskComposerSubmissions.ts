import { Telemetry } from '@macro-inc/observability';
import type { QueryClient } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { taskSubmissionSchema } from './taskComposerDraftSchema';
import type { TaskComposerDraft } from './taskComposerStorage';

const PREFIX = 'task-composer-submission:';

export type TaskComposerSubmission = {
  id: string;
  userId: string;
  contextKey?: string;
  draft: Omit<TaskComposerDraft, 'timestamp'>;
  shareWithTeam: boolean;
};

function storageKey(userId: string, id: string) {
  return `${PREFIX}${encodeURIComponent(userId)}:${id}`;
}

export function taskSubmissionKey(userId: string, id?: string) {
  return id
    ? ['task-composer-submission', userId, id]
    : ['task-composer-submission', userId];
}

export function taskSubmissionDraftStorage(userId: string, id: string) {
  return {
    storageKey: `${storageKey(userId, id)}:editing`,
    expiryMs: null,
  };
}

export function loadTaskSubmissions(
  userId: string,
  contextKey?: string
): TaskComposerSubmission[] {
  const prefix = `${PREFIX}${encodeURIComponent(userId)}:`;
  const submissions: TaskComposerSubmission[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix) || key.endsWith(':editing')) continue;
      try {
        const parsed = taskSubmissionSchema.safeParse(
          JSON.parse(localStorage.getItem(key) ?? 'null')
        );
        if (!parsed.success) continue;
        const value = parsed.data;
        if (
          value?.userId === userId &&
          value.contextKey === contextKey &&
          key === storageKey(userId, value.id)
        ) {
          submissions.push(value);
        }
      } catch {
        // A damaged entry must not hide other recoverable drafts.
      }
    }
  } catch (error) {
    console.warn('Failed to read pending task drafts:', error);
  }
  return submissions;
}

export function clearTaskSubmission(userId: string, id: string) {
  localStorage.removeItem(storageKey(userId, id));
  localStorage.removeItem(taskSubmissionDraftStorage(userId, id).storageKey);
}

/** Other composers must observe a submission completing after its host closes. */
export function createTaskSubmissionList(
  client: QueryClient,
  userId: string,
  contextKey?: string
) {
  const [submissions, setSubmissions] = createSignal(
    loadTaskSubmissions(userId, contextKey)
  );
  onCleanup(
    client.getMutationCache().subscribe(() => {
      setSubmissions(loadTaskSubmissions(userId, contextKey));
    })
  );
  return submissions;
}

/** Persist before starting the request, and retire only the confirmed submission. */
export async function submitTaskDraft<T extends { documentId: string }>(
  client: QueryClient,
  submission: TaskComposerSubmission,
  create: (confirm: (created: T) => void) => Promise<T | null>
): Promise<T | null> {
  const mutationKey = taskSubmissionKey(submission.userId, submission.id);
  if (client.isMutating({ mutationKey })) return null;
  return Telemetry.span('task.compose.submit', async (span) => {
    span.setAttr('task.draft_id', submission.id);
    // Do not send when this fails: closing the app would otherwise lose the input.
    localStorage.setItem(
      storageKey(submission.userId, submission.id),
      JSON.stringify(submission)
    );
    let confirmed: T | undefined;
    const confirm = (created: T) => {
      confirmed = created;
      span.setAttr('document.id', created.documentId);
      span.setAttr('task.creation_confirmed', true);
      try {
        clearTaskSubmission(submission.userId, submission.id);
      } catch (error) {
        console.warn('Failed to retire confirmed task draft:', error);
      }
    };
    return client
      .getMutationCache()
      .build(client, {
        mutationKey,
        retry: false,
        gcTime: 0,
        networkMode: 'always',
        mutationFn: async () => {
          try {
            const result = await span.span('task.compose.create', () =>
              create(confirm)
            );
            if (!result && !confirmed)
              span.error('Task creation was not confirmed');
            return confirmed ?? result;
          } catch (error) {
            // History or project checks cannot undo a confirmed creation.
            if (confirmed) return confirmed;
            throw error;
          }
        },
        onSuccess: (created) => {
          if (created && !confirmed) confirm(created);
        },
      })
      .execute(undefined);
  });
}
