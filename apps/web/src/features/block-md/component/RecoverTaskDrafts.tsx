import { useMutationState } from '@tanstack/solid-query';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import {
  type TaskComposerSubmission,
  taskSubmissionKey,
} from '../util/taskComposerSubmissions';

export function RecoverTaskDrafts(props: {
  userId: string;
  drafts: TaskComposerSubmission[];
  onOpen: (id: string) => void;
}) {
  const pending = useMutationState(() => ({
    filters: {
      mutationKey: taskSubmissionKey(props.userId),
      status: 'pending',
    },
    select: (mutation) => mutation.options.mutationKey?.[2],
  }));

  return (
    <Show when={props.drafts.length > 0}>
      <div class="border-b border-edge-muted p-3 text-sm">
        <p>
          Unconfirmed task drafts are saved on this device. Check Tasks before
          retrying; a request may have reached the server.
        </p>
        <For each={props.drafts}>
          {(draft) => (
            <Button
              variant="outline"
              class="mt-2 max-w-full"
              tooltip={draft.draft.title || 'Untitled task'}
              disabled={pending().includes(draft.id)}
              onClick={() => props.onOpen(draft.id)}
            >
              <span class="truncate">
                {pending().includes(draft.id) ? 'Creating: ' : 'Recover: '}
                {draft.draft.title || 'Untitled task'}
              </span>
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
