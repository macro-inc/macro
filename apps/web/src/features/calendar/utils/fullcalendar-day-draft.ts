import { createPlugin } from '@fullcalendar/core';
import type {
  ViewProps,
  ViewPropsTransformer,
} from '@fullcalendar/core/internal';
import { DAY_DRAFT_ID } from '../core/day-draft';

class DayDraftSelection implements ViewPropsTransformer {
  transform(viewProps: ViewProps) {
    // Native touch resizes require eventSelection before the finger goes down.
    // The open composer's draft is already selected; other events keep native selection.
    const { defs, instances } = viewProps.eventStore;
    for (const instance of Object.values(instances)) {
      if (defs[instance.defId]?.publicId === DAY_DRAFT_ID) {
        return { eventSelection: instance.instanceId };
      }
    }
    return {};
  }
}

export const dayDraftSelectionPlugin = createPlugin({
  name: 'calendar-day-draft-selection',
  viewPropsTransformers: [DayDraftSelection],
});
