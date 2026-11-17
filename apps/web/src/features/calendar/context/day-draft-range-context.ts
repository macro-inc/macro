import { createContext, useContext } from 'solid-js';
import type { DayDraftRangeBinding } from '../core/day-draft';

export const DayDraftRangeContext = createContext<DayDraftRangeBinding>();

export const useDayDraftRange = () => useContext(DayDraftRangeContext);

/** Split params are untyped at the host boundary. */
export function isDayDraftRangeBinding(
  value: unknown
): value is DayDraftRangeBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bind' in value &&
    typeof value.bind === 'function' &&
    'range' in value &&
    typeof value.range === 'function' &&
    'interacting' in value &&
    typeof value.interacting === 'function' &&
    'resize' in value &&
    typeof value.resize === 'function' &&
    'canResize' in value &&
    typeof value.canResize === 'function' &&
    'startInteraction' in value &&
    typeof value.startInteraction === 'function' &&
    'stopInteraction' in value &&
    typeof value.stopInteraction === 'function' &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  );
}
