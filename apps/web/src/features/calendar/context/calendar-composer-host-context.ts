import { type Accessor, createContext, useContext } from 'solid-js';
import type { ComposerOpenRequest } from '../core/composer-session';
import type { CalendarComposerSession } from '../primitives/create-calendar-composer-session';
import type { ComposerHeaderDrag } from '../primitives/create-composer-header-drag';

export interface CalendarComposerHostContextValue {
  sessions: CalendarComposerSession;
  canPinComposer: Accessor<boolean>;
  composerPinned: Accessor<boolean>;
  boundary: Accessor<HTMLElement | undefined>;
  dock: Accessor<HTMLElement | undefined>;
  setDock: (element: HTMLElement | undefined) => void;
  drag: Accessor<ComposerHeaderDrag | undefined>;
  setDrag: (drag: ComposerHeaderDrag | undefined) => void;
  cardPinned: Accessor<boolean>;
  setCardPinned: (pinned: boolean) => void;
  leftPanelPinned: Accessor<boolean>;
  open: (request: ComposerOpenRequest) => Promise<number | undefined>;
}
export const CalendarComposerHostContext =
  createContext<CalendarComposerHostContextValue>();
export const useCalendarComposerHost = () =>
  useContext(CalendarComposerHostContext);
