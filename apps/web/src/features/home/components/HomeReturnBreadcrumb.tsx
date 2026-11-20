import { ViewBreadcrumbs } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export function HomeReturnBreadcrumb(props: { onReturn: () => void }) {
  return (
    <nav aria-label="Home location" class="flex items-center gap-0.5">
      <ViewBreadcrumbs.ReturnButton
        data-allow-focus-in-preview
        onClick={props.onReturn}
      >
        {isTouchDevice() ? 'Notifications' : 'Home'}
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator />
    </nav>
  );
}
