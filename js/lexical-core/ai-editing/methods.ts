import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';
import { runAgent } from './agents/supervisor';
import { createEditingSession, loadSnapshot, toSnapshot } from './ai-toolkit';
import type { AwarenessSource } from './awareness/awareness-source';
import type { DocumentOpQueueParams } from './queue/document-op-queue';

export type Usage = { inputTokens: number; outputTokens: number };

/** Per-request knobs shared by every editing method. */
export type EditOptions = {
  /** Run an intent-interpretation pass before editing. */
  interpret?: boolean;
  /** Model for child (writer) agents. Defaults to the top-level model if omitted. */
  childModel?: LanguageModel;
  /** Build a writer's live cursor identity (name + color); omit for no on-screen cursors. */
  makeAwareness?: (name: string, color: string) => AwarenessSource;
  /** Serialization format fed to the agents. Default 'xml'. */
  docFormat?: 'markdown' | 'xml';
  /** Animation tuning (speed, ranges). */
  params?: DocumentOpQueueParams;
  /** Abort signal — fires when the client disconnects or cancels the request. */
  signal?: AbortSignal;
};

/**
 * A way of editing the document. Hydrates from `snapshot`, runs its own agent
 * loop, and pushes each new state out through `commit`. Stateless per request —
 * the live harness owns sync; the method owns "how an edit happens".
 */
export type EditMethod = (
  snapshot: SerializedEditorState,
  request: string,
  model: LanguageModel,
  commit: (next: SerializedEditorState) => void,
  opts?: EditOptions
) => Promise<Usage>;

/** Edit via the coder agent (declarative `editor` ops on a Lexical session). */
export const editViaCode: EditMethod = async (snapshot, request, model, commit, opts = {}) => {
  const session = createEditingSession();
  loadSnapshot(session, snapshot);
  const { totalUsage } = await runAgent(session, request, model, {
    propagate: () => commit(toSnapshot(session)),
    makeAwareness: opts.makeAwareness,
    childModel: opts.childModel,
    interpret: opts.interpret,
    docFormat: opts.docFormat,
    params: opts.params,
    signal: opts.signal,
  });
  return {
    inputTokens: totalUsage.inputTokens ?? 0,
    outputTokens: totalUsage.outputTokens ?? 0,
  };
};
