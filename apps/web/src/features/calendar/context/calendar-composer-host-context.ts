import { type Accessor, createContext, useContext } from 'solid-js';
import type { ComposerOpenRequest } from '../core/composer-session';
import type { CalendarComposerSession } from '../primitives/create-calendar-composer-session';

export interface CalendarComposerHostContextValue {
  sessions: CalendarComposerSession;
  boundary: Accessor<HTMLElement | undefined>;
  dock: Accessor<HTMLElement | undefined>;
  setDock: (element: HTMLElement | undefined) => void;
  open: (request: ComposerOpenRequest) => Promise<number | undefined>;
}
export const CalendarComposerHostContext =
  createContext<CalendarComposerHostContextValue>();
export const useCalendarComposerHost = () =>
  useContext(CalendarComposerHostContext);
