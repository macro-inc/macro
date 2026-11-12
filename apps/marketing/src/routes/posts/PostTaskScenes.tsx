import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { EmailThread } from '../../features/marketing/components/email/frozen/EmailThread';
import { TaskComposer } from '../../features/marketing/components/workspace/frozen/TaskComposer';
import type { WorkspaceTask } from '../../features/marketing/core/dummy-workspace';
import { meetingEmail } from '../../features/marketing/core/email-demo-story';
import '../../features/marketing/components/tasks/task-creation-flow.css';
import '../../features/marketing/components/email/email-feature-demos.css';

export function PostTaskComposer() {
  const [draft, setDraft] = createStore<WorkspaceTask>({
    id: 'blog-setup',
    title: 'Send the setup plan',
    description: 'Send Austin Barron the plan before Thursday’s demo.',
    status: 'Not Started',
    priority: 'High',
    owner: 'julia',
    creator: 'jacob',
    tags: [],
    channel: '',
    steps: [],
    comments: [],
  });
  const [state, setState] = createSignal<'editing' | 'created' | 'closed'>(
    'editing'
  );
  return (
    <div class="post-task-example">
      <Show
        when={state() === 'editing'}
        fallback={
          <div class="post-task-created glass" role="status">
            <strong>{draft.title}</strong>
            <span>
              {draft.status} · {draft.priority}
            </span>
            <span>
              {state() === 'created' ? 'Created in this demo' : 'Draft closed'}
            </span>
            <Button onClick={() => setState('editing')} variant="plain">
              Create another
            </Button>
          </div>
        }
      >
        <TaskComposer
          draft={draft}
          update={setDraft}
          submit={() => setState('created')}
          close={() => setState('closed')}
          dueDateLabel="Thursday"
        />
      </Show>
    </div>
  );
}

export function PostEmailTask() {
  return (
    <div class="post-email-task">
      <div class="post-email-surface glass">
        <EmailThread email={meetingEmail} hideReply />
      </div>
      <PostTaskComposer />
    </div>
  );
}
