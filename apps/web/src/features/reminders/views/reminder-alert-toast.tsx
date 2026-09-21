import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import BellIcon from '@phosphor/bell.svg';
import { type Accessor, For, Show } from 'solid-js';
import type { ReminderAlert } from '../core/reminder-alert';

export function showReminderAlert(
  items: Accessor<readonly ReminderAlert[]>,
  acknowledge: () => void,
  open: (reminderId?: string) => boolean
): () => void {
  const id = toast.custom(
    {
      get title() {
        return items().length === 1
          ? 'Reminder'
          : `${items().length} reminders`;
      },
      icon: BellIcon,
      color: 'var(--color-accent)',
      content: () => (
        <div
          class="space-y-2 text-sm text-ink"
          aria-live="polite"
          aria-atomic="true"
        >
          <For each={items().slice(0, 3)}>
            {(item) => (
              <div>
                <p class="line-clamp-2 break-words">
                  {markdownToPlainText(item.description)}
                </p>
                <Show when={item.scheduledFor}>
                  {(date) => (
                    <p class="text-xs text-ink-muted">
                      {new Date(date()).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  )}
                </Show>
              </div>
            )}
          </For>
          <Show when={items().length > 3}>
            <p class="text-xs text-ink-muted">And {items().length - 3} more</p>
          </Show>
        </div>
      ),
      get actions() {
        return [
          {
            label: items().length === 1 ? 'Open reminder' : 'View reminders',
            onClick: () => {
              const item = items()[0];
              if (!item) return;
              if (open(items().length === 1 ? item.reminderId : undefined))
                acknowledge();
            },
          },
        ];
      },
    },
    {
      persistent: true,
      region: isMobile() ? 'mobile-reminder-region' : 'reminder-region',
      onUserDismiss: acknowledge,
    }
  );
  return () => toast.dismiss(id);
}
