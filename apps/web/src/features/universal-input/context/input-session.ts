import type { JSX } from 'solid-js';
import type { Intent } from '../core/input';
import type { InputLayout } from './capabilities';

/** The form's primary action, for a host that keeps its own editor and keys. */
export interface InputControls {
  submit(): Promise<void>;
  /** False while inference, a send, or an unmet requirement blocks submission. */
  ready(): boolean;
}

/** The host owns its text, input placement and navigation lifecycle. */
export interface InputSession {
  text: string;
  layout: InputLayout;
  /**
   * A type the host already recognized, so the form opens on it instead of
   * asking again. Inference still runs and may replace it, because the writer
   * keeps editing the same text.
   */
  intent?: Intent;
  selection?: { start: number; end: number };
  /** Supply null when the host keeps its own editor mounted outside the form. */
  editor?: JSX.Element;
  onTextChange(text: string): void;
  onSendingChange?(sending: boolean): void;
  /** Receives the controls while the form is mounted, and undefined after. */
  captureControls?(controls: InputControls | undefined): void;
  onComplete(): void;
  onNavigate(): void;
}
