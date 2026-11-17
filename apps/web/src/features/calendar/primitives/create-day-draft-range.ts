import { beginInteraction } from '@app/observability/flow';
import { TZDateMini } from '@date-fns/tz';
import { format } from 'date-fns';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import type {
  DayDraftEditor,
  DayDraftRange,
  DayDraftRangeBinding,
} from '../core/day-draft';
import { composerRangeInstants } from './composer-time-zone';

/** A single unsaved grid draft belongs to the composer that opened it. */
export function createDayDraftRange(
  initial: DayDraftRange
): DayDraftRangeBinding {
  const [binding, setBinding] = createSignal<
    { initial: DayDraftRange } | { model: DayDraftEditor } | undefined
  >({ initial });
  const [interacting, setInteracting] = createSignal(false);
  let disposed = false;
  const model = () => {
    const current = binding();
    return current && 'model' in current ? current.model : undefined;
  };
  let interaction: ReturnType<typeof beginInteraction> | undefined;
  const stopInteraction = () => {
    interaction?.end();
    interaction = undefined;
    setInteracting(false);
  };
  const range = createMemo(() => {
    const current = binding();
    if (!current) return undefined;
    if ('initial' in current) return current.initial;
    return composerRangeInstants(
      current.model.state(),
      current.model.timeZone()
    );
  });
  const canResize = () => {
    const composer = model();
    return (
      !!composer &&
      !disposed &&
      !composer.state().allDay &&
      !composer.range.startDisabled &&
      !composer.range.endDisabled
    );
  };

  return {
    range,
    canResize,
    interacting,
    bind(composer: DayDraftEditor) {
      if (disposed) return;
      setBinding({ model: composer });
      onCleanup(() => {
        if (model() !== composer) return;
        setBinding();
        stopInteraction();
      });
    },
    resize(next: DayDraftRange) {
      const composer = model();
      if (!composer || !canResize() || next.end <= next.start) return false;
      const zone = composer.timeZone();
      const start = format(
        TZDateMini.tz(zone, next.start),
        "yyyy-MM-dd'T'HH:mm"
      );
      const end = format(TZDateMini.tz(zone, next.end), "yyyy-MM-dd'T'HH:mm");
      const converted = composerRangeInstants(
        { start, end, allDay: false },
        zone
      );
      // An ambiguous DST fold cannot be represented by these minute-only fields.
      if (
        !converted ||
        converted.start.getTime() !== next.start.getTime() ||
        converted.end.getTime() !== next.end.getTime()
      )
        return false;
      composer.controller.setRange(start, end);
      return true;
    },
    startInteraction() {
      stopInteraction();
      interaction = beginInteraction('calendar.draft.resize');
      setInteracting(true);
    },
    stopInteraction,
    dispose() {
      disposed = true;
      setBinding();
      stopInteraction();
    },
  };
}
