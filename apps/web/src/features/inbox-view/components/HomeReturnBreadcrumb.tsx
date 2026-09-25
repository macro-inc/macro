import { ViewBreadcrumbs } from '@app/components/view-shell';

export function HomeReturnBreadcrumb(props: { onReturn: () => void }) {
  return (
    <nav aria-label="Home location" class="flex items-center gap-0.5">
      <ViewBreadcrumbs.ReturnButton
        data-allow-focus-in-preview
        onClick={props.onReturn}
      >
        Home
      </ViewBreadcrumbs.ReturnButton>
      <ViewBreadcrumbs.Separator />
    </nav>
  );
}
