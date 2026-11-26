import {
  CalendarComposerEditor,
  type StandaloneComposerProps,
} from '@app/features/calendar/CalendarComposerEditor';
import { t } from '@app/lib/i18n';
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
    panel.handle.setDisplayName(
      props.event ? t('calendar.editEvent') : t('calendar.newEvent')
    )
  );
  return (
    <CalendarComposerEditor
      {...props}
      onSaved={props.onSaveSuccess}
      onClose={() => panel.handle.close()}
    />
  );
}
