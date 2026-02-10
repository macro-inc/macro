import { Show } from 'solid-js';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import { extractMessageContent } from '../utils/notification';

interface NotificationContentProps {
  notification?: Notification;
  stack?: NotificationStack;
  singleLine?: boolean;
}

/**
 * Displays the content/preview of a notification
 * For single notifications, shows the message content
 * For stacks, shows the most recent notification's content
 */
export function NotificationContent(props: NotificationContentProps) {
  const content = () => {
    if (props.notification) {
      return extractMessageContent(props.notification);
    }
    if (props.stack && props.stack.notifications.length > 0) {
      return extractMessageContent(props.stack.notifications[0]);
    }
    return '';
  };

  return (
    <Show when={content()}>
      {(text) => (
        <Show
          when={text().trim()}
          fallback={
            <span class="italic text-ink-disabled">Attached items</span>
          }
        >
          {(trimmedContent) => (
            <StaticMarkdown
              markdown={trimmedContent()}
              theme={unifiedListMarkdownTheme}
              singleLine={props.singleLine ?? true}
            />
          )}
        </Show>
      )}
    </Show>
  );
}
