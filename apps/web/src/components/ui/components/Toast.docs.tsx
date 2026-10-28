import { defineDoc } from '@app/features/ui-gallery/types';
import { toast } from '@core/component/Toast/Toast';
import LinkIcon from '@icon/system/regular/link.svg';
import { onCleanup } from 'solid-js';
import { Button } from './Button';

// #region demo:notifications
function NotificationsDemo() {
  const ids: number[] = [];
  const remember = (id: number | undefined) => {
    if (id !== undefined) ids.push(id);
  };
  onCleanup(() => ids.forEach((id) => toast.dismiss(id)));
  return (
    <div class="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() =>
          remember(toast.success('Changes saved', { stack: true }))
        }
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          for (const message of [
            'Link copied',
            'Document saved',
            'Files organized',
          ]) {
            remember(toast.success(message, { stack: true, duration: 12000 }));
          }
        }}
      >
        Preview stack
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          remember(
            toast.custom(
              {
                title: 'Reconnect email and calendar',
                content: () => 'alex@example.com',
                icon: LinkIcon,
                actions: [
                  {
                    label: 'Reconnect',
                    onClick: () =>
                      remember(
                        toast.success('Preview only — no account changes', {
                          stack: true,
                        })
                      ),
                  },
                ],
              },
              { persistent: true, region: 'prompt-region' }
            )
          )
        }
      >
        Persistent prompt
      </Button>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Toast',
  category: 'Feedback',
  description:
    'Compact notifications with soft light-theme shadows, raised dark-theme surfaces, a layered desktop stack, gentle entrance and exit motion, and accessible actions. Hover or focus the stack to expand it and pause dismissal.',
  import: "import { toast } from '@core/component/Toast/Toast';",
  demos: [
    { id: 'notifications', title: 'Notifications', render: NotificationsDemo },
  ],
  guidelines: {
    do: [
      'Use a short title and put supporting details in subtext.',
      'Reserve persistent prompts for notices that need a response.',
      'Verify both themes, keyboard focus, and reduced motion.',
    ],
    dont: [
      'Use a toast for information that must remain in the page.',
      'Add custom colors, shadows, or animations in consumers.',
    ],
  },
});
