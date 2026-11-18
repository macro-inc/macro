import {
  StandaloneComposer,
  type StandaloneComposerProps,
} from '@app/features/calendar/views/composer/StandaloneComposer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { onMount } from 'solid-js';

/** Keep the registered split route as an adapter to the shared composer views. */
export function EventComposerSplit(
  props: Omit<StandaloneComposerProps, 'onClose' | 'onSaved'> & {
    onSaveSuccess?: () => void;
  }
) {
  const panel = useSplitPanelOrThrow();
  onMount(() =>
    panel.handle.setDisplayName(props.event ? 'Edit event' : 'New event')
  );
  return (
    <StandaloneComposer
      {...props}
      onSaved={props.onSaveSuccess}
      onClose={() => panel.handle.close()}
    />
  );
}
