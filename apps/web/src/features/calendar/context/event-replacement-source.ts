import type {
  EventReplacementPreview,
  EventReplacementTarget,
} from '../core/event-replacement';

/** Provider-independent operations required by the replacement confirmation controller. */
export interface EventReplacementSource {
  prepare(
    target: EventReplacementTarget,
    removeConference: boolean
  ): Promise<EventReplacementPreview>;
  confirm(operationId: string): Promise<EventReplacementPreview>;
  status(operationId: string): Promise<EventReplacementPreview>;
  discard(operationId: string): Promise<void>;
}

/** Presentation contract; the view owns the reactive controller and production source. */
export interface EventReplacementController {
  open(): boolean;
  setOpen(value: boolean): void;
  pending(): boolean;
  error(): string | undefined;
  preview(): EventReplacementPreview | undefined;
  confirmationAttempted(): boolean;
  removeConference(): boolean;
  setRemoveConference(value: boolean): void;
  onlyOccurrence(): boolean;
  setOnlyOccurrence(value: boolean): void;
  prepare(): Promise<void>;
  confirm(): Promise<void>;
  check(): Promise<void>;
  changeOptions(): Promise<void>;
}
