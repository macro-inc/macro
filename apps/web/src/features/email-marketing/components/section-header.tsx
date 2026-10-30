import { ViewShell } from '@app/components/view-shell';
import { ListHeader } from '@app/components/view-shell/ListHeader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';

/**
 * One header row: title (and view tabs) on the left, actions on the right.
 * Touch hides the desktop top bar, so it stacks the same parts in the
 * content header, under the section navigation that replaces the sidebar.
 */
export function SectionHeader(props: {
  title: JSX.Element;
  actions?: JSX.Element;
  touchNavigation?: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<ListHeader title={props.title}>{props.actions}</ListHeader>}
    >
      <ViewShell.Header class="space-y-3">
        {props.touchNavigation}
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">{props.title}</div>
          <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
        </div>
      </ViewShell.Header>
    </Show>
  );
}
