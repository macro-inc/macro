import type {
  EventReplacementPreview,
  EventReplacementRequest,
} from '../core/event-replacement';

/** Provider-independent operations required by the replacement confirmation controller. */
export interface EventReplacementSource {
  prepare(request: EventReplacementRequest): Promise<EventReplacementPreview>;
  confirm(operationId: string): Promise<EventReplacementPreview>;
  status(operationId: string): Promise<EventReplacementPreview>;
  discard(operationId: string): Promise<void>;
}

/** Presentation contract; the view owns the reactive controller and production source. */
export interface EventReplacementController {
  open(): boolean;
  close(): void;
  pending(): boolean;
  error(): string | undefined;
  preview(): EventReplacementPreview | undefined;
  confirmationAttempted(): boolean;
  start(request: EventReplacementRequest): Promise<void>;
  prepare(): Promise<void>;
  confirm(): Promise<void>;
  check(): Promise<void>;
}
