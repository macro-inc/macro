import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import type { JSX } from 'solid-js';

/** The desktop list's own header: collapse, the title, and its actions. */
export function InboxListHeader(props: { actions: JSX.Element }) {
  return (
    <header class="flex shrink-0 flex-col">
      <ViewSidebar.Header>
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>{t('nav.notifications')}</ViewSidebar.Title>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            {props.actions}
          </div>
        </div>
      </ViewSidebar.Header>
    </header>
  );
}

/** A list state in place of rows: loading failed, or no rows match. */
export function InboxListStatus(props: { children: JSX.Element }) {
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-ink-muted touch:pt-(--mobile-content-inset-top)">
      {props.children}
    </div>
  );
}
