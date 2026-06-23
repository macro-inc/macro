import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';
import { runAgent, type SearchContacts } from './agents/supervisor';
import { createEditingSession, loadSnapshot, toSnapshot } from './ai-toolkit';
import type { AwarenessSource } from './awareness/awareness-source';
import type { DocumentOpQueueParams } from './queue/types';
import type { CodeRunner } from './runtime';

export type Usage = { inputTokens: number; outputTokens: number };

/** Per-request knobs shared by every editing method. */
export type EditOptions = {
  runner: CodeRunner;
  /** Run an intent-interpretation pass before editing. */
  interpret?: boolean;
  /** Model for child (writer) agents. Defaults to the top-level model if omitted. */
  childModel?: LanguageModel;
  /** Build a writer's live cursor identity (name + color). */
  makeAwareness: (name: string, color: string) => AwarenessSource;
  /** Serialization format fed to the agents. Default 'xml'. */
  docFormat?: 'markdown' | 'xml';
  /** Animation tuning (speed, ranges). */
  params?: DocumentOpQueueParams;
  /** Skip typing animations — apply ops directly with no pauses or cursor movement. */
  typingAnimations?: boolean;
  /** Abort signal -- fires when the client disconnects or cancels the request. */
  signal?: AbortSignal;
  /** Resolve a name query to contact/user results. */
  searchContacts?: SearchContacts;
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
  opts: EditOptions
) => Promise<Usage>;

/** Edit via the coder agent (declarative `editor` ops on a Lexical session). */
export const editViaCode: EditMethod = async (snapshot, request, model, commit, opts) => {
  const session = createEditingSession();
  loadSnapshot(session, snapshot);
  const { totalUsage } = await runAgent(session, request, model, {
    propagate: () => commit(toSnapshot(session)),
    runner: opts.runner,
    makeAwareness: opts.makeAwareness,
    childModel: opts.childModel,
    interpret: opts.interpret,
    docFormat: opts.docFormat,
    params: opts.params,
    typingAnimations: opts.typingAnimations,
    signal: opts.signal,
    searchContacts: opts.searchContacts ?? (() => Promise.resolve([])),
  });
  return {
    inputTokens: totalUsage.inputTokens ?? 0,
    outputTokens: totalUsage.outputTokens ?? 0,
  };
};
