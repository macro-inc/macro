import { onCleanup, type ParentProps } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { ComposerWhenContext } from '../../../context/composer-when-context';
import { createComposerWhen } from '../../../primitives/create-composer-when';

export function ComposerWhenRoot(props: ParentProps) {
  const model = useCalendarComposer();
  const when = createComposerWhen({
    range: model.range,
    setRange: model.controller.setRange,
    setAllDay: model.controller.setAllDay,
    detailsRevision: model.controller.detailsRevision,
  });
  onCleanup(() => when.close());
  return (
    <ComposerWhenContext.Provider value={when}>
      {props.children}
    </ComposerWhenContext.Provider>
  );
}
