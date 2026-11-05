import { ViewBreadcrumbs } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';

/** The way back from what the content area shows to the notifications list. */
export function NotificationsBreadcrumb(props: { onReturn: () => void }) {
  return (
    <nav
      aria-label={t('notificationsInbox.location')}
      class="flex items-center gap-0.5"
    >
      <ViewBreadcrumbs.ReturnButton
        data-allow-focus-in-preview
        onClick={props.onReturn}
      >
        {t('nav.notifications')}
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator />
    </nav>
  );
}
