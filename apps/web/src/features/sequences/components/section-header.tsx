import { ViewShell } from '@app/components/view-shell';
import { ListHeader } from '@app/components/view-shell/ListHeader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';

/**
 * One header row: title (and view tabs) on the left, actions on the right.
 * Touch hides the desktop top bar, so the same parts stack in the content
 * header, under the Customers view strip.
 */
export function SectionHeader(props: {
  title: JSX.Element;
  actions?: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<ListHeader title={props.title}>{props.actions}</ListHeader>}
    >
      <ViewShell.Header class="touch:pt-0">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">{props.title}</div>
          <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
        </div>
      </ViewShell.Header>
    </Show>
  );
}
