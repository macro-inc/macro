import type { JSX } from 'solid-js';
import type { InputLayout } from './capabilities';

/** The host owns its text, input placement and navigation lifecycle. */
export interface InputSession {
  text: string;
  layout: InputLayout;
  selection?: { start: number; end: number };
  /** Supply null when the host keeps its own editor mounted outside the form. */
  editor?: JSX.Element;
  onTextChange(text: string): void;
  onSendingChange?(sending: boolean): void;
  onComplete(): void;
  onNavigate(): void;
}
