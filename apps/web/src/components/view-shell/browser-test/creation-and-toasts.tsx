import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import '@app/index.css';
import { TasksCreateMenu } from '@app/features/tasks-view/components/TasksCreateMenu';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { Button, Tabs } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Fixture() {
  const [view, setView] = createSignal('messages');
  const [selected, setSelected] = createSignal('Nothing created');
  const [dismissals, setDismissals] = createSignal(0);
  return (
    <main class="min-h-screen bg-page p-8 text-ink">
      <h1 class="mb-6 text-xl font-semibold">
        Creation menus and notifications
      </h1>
      <div class="flex flex-wrap gap-3">
        <TasksCreateMenu
          presentation="toolbar"
          onCreateTask={() => setSelected('Task')}
          onCreateSubtask={() => setSelected('Subtask')}
          onCreateProject={() => setSelected('Project')}
          onCreateTag={() => setSelected('Tag')}
        />
        <Button
          onClick={() => {
            for (const message of [
              'Link copied',
              'Document saved',
              'Files organized',
            ])
              toast.success(message, { stack: true, duration: 30000 });
          }}
        >
          Show notices
        </Button>
        <Button
          onClick={() =>
            toast.custom(
              {
                title: 'Connection needs attention',
                content: () => 'Demo only — no account changes.',
                actions: [
                  {
                    label: 'Review',
                    onClick: () => setSelected('Reviewed demo'),
                  },
                ],
              },
              {
                persistent: true,
                region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
                onUserDismiss: () => setDismissals((count) => count + 1),
              }
            )
          }
        >
          Show prompt
        </Button>
        <Button
          onClick={() =>
            toast.custom(
              { title: 'Reminder preview' },
              {
                persistent: true,
                region: isMobile()
                  ? 'mobile-reminder-region'
                  : 'reminder-region',
                onUserDismiss: () => setDismissals((count) => count + 1),
              }
            )
          }
        >
          Show reminder
        </Button>
      </div>
      <p class="mt-5 text-sm text-ink-muted">
        {selected()} — this preview does not save data.
      </p>
      <p>Dismissals: {dismissals()}</p>
      <div class="mt-6">
        <Tabs
          aria-label="Channel views"
          options={[
            { value: 'messages', label: 'Messages' },
            { value: 'attachments', label: 'Attachments' },
            { value: 'calls', label: 'Calls' },
            { value: 'participants', label: 'Participants' },
          ]}
          value={view()}
          onChange={setView}
        />
      </div>
      <ToastRegion />
    </main>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
