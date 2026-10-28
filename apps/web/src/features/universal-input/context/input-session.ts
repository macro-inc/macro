import type { JSX } from 'solid-js';
import type { Intent } from '../core/input';
import type { InputLayout } from './capabilities';

/** The host owns its text, input placement and navigation lifecycle. */
export interface InputSession {
  text: string;
  layout: InputLayout;
  selection?: { start: number; end: number };
  /** The shape the host already recognized, which the draft opens locked to. */
  intent?: Intent;
  /** Supply null when the host keeps its own editor mounted outside the form. */
  editor?: JSX.Element;
  /** Hosts whose text cannot change, such as a selection, leave this out. */
  onTextChange?(text: string): void;
  onSendingChange?(sending: boolean): void;
  onComplete(): void;
  onNavigate(): void;
}
