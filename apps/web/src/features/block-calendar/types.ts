import type { CalendarViewTarget } from '@app/features/calendar-view/types';

/** Stable identity retained for legacy Calendar block entries and previews. */
export const CALENDAR_BLOCK_ID = 'view';

/** Compatibility params accepted by the retired Calendar block adapter. */
export interface CalendarBlockProps extends CalendarViewTarget {}
