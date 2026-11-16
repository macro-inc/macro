import { StandaloneComposer } from '@app/features/calendar/views/composer/StandaloneComposer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ComponentProps, onMount, Show } from 'solid-js';
import { EventComposerSplit } from './EventComposerSplit';

/** Outside a calendar workspace, keep the split host and select its desktop editor. */
export function CalendarComposerSplitAdapter(
  props: ComponentProps<typeof EventComposerSplit>
) {
  const panel = useSplitPanelOrThrow();
  onMount(() =>
    panel.handle.setDisplayName(props.event ? 'Edit event' : 'New event')
  );
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <StandaloneComposer
          event={props.event}
          initialValues={props.initialValues}
          suggestedValues={props.suggestedValues}
          onCalendarChange={props.onCalendarChange}
          onDirtyChange={props.onDirtyChange}
          onCreated={props.onCreated}
          onSaved={props.onSaveSuccess}
          onClose={() => panel.handle.close()}
        />
      }
    >
      <EventComposerSplit {...props} />
    </Show>
  );
}
