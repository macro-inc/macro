import type { SerializedEditorState } from 'lexical';
import type { DocumentOp } from './ai-editing/editor';
import type { Awareness } from './ai-editing/queue';

/** The peer (pooled AI identity) that produced an event — one cursor on replay. */
export type ReplayPeer = { name: string; color: string };

/** One recorded operation: an applied edit, a cursor/selection move, or a
 *  writer releasing its cursor. `t` is ms since the session started. */
export type ReplayEvent = { t: number; peer: ReplayPeer } & (
  | { kind: 'edit'; op: DocumentOp }
  | { kind: 'awareness'; x: Awareness }
  | { kind: 'clear' }
);

/** Everything needed to replay a session with no AI, Loro, or sync: the starting
 *  document plus the full, peer-tagged, time-stamped operation log. Apply the
 *  events in order against `initial` to reconstruct the typed-out document. */
export type ReplayTrace = {
  initial: SerializedEditorState;
  events: ReplayEvent[];
};
