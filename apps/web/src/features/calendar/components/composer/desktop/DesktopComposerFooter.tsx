import { type JSX, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { ComposerCancel } from '../actions/ComposerCancel';
import { ComposerSubmit } from '../actions/ComposerSubmit';
import { ComposerScope } from '../scope/ComposerScope';

export function DesktopComposerFooter(props: {
  leading?: JSX.Element;
  f3?: boolean;
  onCancel: () => void;
}) {
  const model = useCalendarComposer();
  return (
    <>
      <Show when={model.options.showRecurringEditNotice}>
        <div class="shrink-0 px-4 pb-2">
          <ComposerScope />
        </div>
      </Show>
      <div
        class={
          props.f3
            ? 'flex shrink-0 items-center gap-2 border-t border-divider py-4 pr-4 pl-2'
            : 'flex shrink-0 items-center gap-2 border-t border-divider pt-2.5 pr-3 pb-3.5 pl-2'
        }
      >
        {props.leading}
        <div class="flex-1" />
        <Show
          when={props.f3}
          fallback={
            <>
              <ComposerCancel onCancel={props.onCancel} />
              <ComposerSubmit />
            </>
          }
        >
          <div class="flex gap-1">
            <ComposerCancel f3 onCancel={props.onCancel} />
            <ComposerSubmit f3 />
          </div>
        </Show>
      </div>
    </>
  );
}
