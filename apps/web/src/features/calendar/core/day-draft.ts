export const DAY_DRAFT_ID = 'calendar-unsaved-day-draft';

export interface DayDraftRange {
  start: Date;
  end: Date;
}

/** Only range state and actions cross the grid/composer boundary. */
export interface DayDraftEditor {
  state(): { start: string; end: string; allDay: boolean };
  timeZone(): string;
  range: { readonly startDisabled: boolean; readonly endDisabled: boolean };
  controller: { setRange(start: string, end: string): void };
}

export interface DayDraftRangeBinding {
  range(): DayDraftRange | undefined;
  canResize(): boolean;
  interacting(): boolean;
  bind(editor: DayDraftEditor): void;
  resize(range: DayDraftRange): boolean;
  startInteraction(): void;
  stopInteraction(): void;
  dispose(): void;
}
