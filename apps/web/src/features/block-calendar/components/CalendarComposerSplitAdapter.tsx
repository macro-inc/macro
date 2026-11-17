import { StandaloneComposer } from '@app/features/calendar/views/composer/StandaloneComposer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { type ComponentProps, onMount } from 'solid-js';
import type { EventComposerSplit } from './EventComposerSplit';

/** Adapt the popover split lifecycle; the composer owns its platform layout. */
export function CalendarComposerSplitAdapter(
  props: ComponentProps<typeof EventComposerSplit> & {
    initialDrawerHeight?: number;
  }
) {
  const panel = useSplitPanelOrThrow();
  onMount(() =>
    panel.handle.setDisplayName(props.event ? 'Edit event' : 'New event')
  );
  return (
    <StandaloneComposer
      event={props.event}
      initialValues={props.initialValues}
      suggestedValues={props.suggestedValues}
      initialDrawerHeight={props.initialDrawerHeight}
      onCalendarChange={props.onCalendarChange}
      onDirtyChange={props.onDirtyChange}
      onCreated={props.onCreated}
      onSaved={props.onSaveSuccess}
      onClose={() => panel.handle.close()}
    />
  );
}
