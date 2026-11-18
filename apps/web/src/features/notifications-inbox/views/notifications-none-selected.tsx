import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import { EmptyStatePanel } from '@ui';
import { Show } from 'solid-js';

/**
 * The preview with nothing chosen. With the list collapsed it keeps the top
 * bar, like Home's idle pane, so the shared toggle can bring the list back.
 */
export function NotificationsNoneSelected() {
  const shell = useViewShell();
  return (
    <>
      <Show when={shell.aside.isCollapsed() || shell.aside.isOverlay()}>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>
            {t('nav.notifications')}
          </ViewSidebar.Title>
        </ViewShell.TopBar>
      </Show>
      <EmptyStatePanel
        centered
        class="min-h-0 flex-1"
        graphic={EmptyStateInboxTrayGraphic}
        title={t('notificationsInbox.noneSelectedTitle')}
        description={t('notificationsInbox.noneSelectedDescription')}
      />
    </>
  );
}
