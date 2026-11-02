import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, Show } from 'solid-js';
import { Button } from './Button';
import { NotificationStack } from './NotificationStack';

// #region demo:updates
function UpdatesDemo() {
  const [updates, setUpdates] = createSignal([
    {
      id: 'approval',
      agent: 'desktop-cef',
      message: 'Needs approval to sign the app bundle.',
      age: '2m',
    },
    {
      id: 'question',
      agent: 'sdk-soup-endpoint',
      message: 'Asked whether refreshSoup should be public.',
      age: '4m',
    },
    {
      id: 'stalled',
      agent: 'pdf-overlay-zoom',
      message: 'The build has been stalled for 23 minutes.',
      age: '23m',
    },
    {
      id: 'review',
      agent: 'granola-refresh',
      message: 'The fix is green and ready for review.',
      age: '6m',
    },
  ]);
  return (
    <div class="w-full max-w-xl">
      <NotificationStack
        label="Coding agent updates"
        title={
          <span class="font-semibold">
            {updates().length} updates from coding agents
          </span>
        }
        items={updates()}
        itemKey={(item) => item.id}
      >
        {(item) => (
          <div class="flex items-start gap-3 p-3 text-sm">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-ink">{item.agent}</div>
              <div class="text-ink-muted">{item.message}</div>
              <div class="mt-1 text-xs text-ink-extra-muted">
                {item.age} ago
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setUpdates((current) =>
                  current.filter((update) => update.id !== item.id)
                )
              }
            >
              Dismiss
            </Button>
          </div>
        )}
      </NotificationStack>
      <Show when={updates().length === 0}>
        <p class="px-2 text-sm text-ink-muted">All updates dismissed</p>
      </Show>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'NotificationStack',
  category: 'Data Display',
  status: 'beta',
  exports: ['NotificationStack'],
  import: "import { NotificationStack } from '@ui';",
  description:
    'Groups a short queue of independent updates into a compact stack. The front card stays actionable; Show all reveals every card. Cards use stable keys so removals can animate.',
  demos: [
    {
      id: 'updates',
      title: 'Coding agent updates',
      description: 'Expand the stack or dismiss individual updates.',
      render: UpdatesDemo,
      fill: true,
    },
  ],
});
