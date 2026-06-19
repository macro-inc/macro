import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';
import { toXml } from '../transformers/xml-transformer';
import { runAgent } from './agents/agent';
import { runBashAgent } from './agents/bash-agent';
import { createEditingSession, loadSnapshot, toSnapshot } from './ai-toolkit';

export type Usage = { inputTokens: number; outputTokens: number };

/** Per-request knobs shared by every editing method. */
export type EditOptions = {
  /** Feed a running diff back to the agent each step so it converges on a final state. */
  reportDiff?: boolean;
  /** Run an intent-interpretation pass before editing. */
  interpret?: boolean;
  /** Model for child (writer) agents. Defaults to the top-level model if omitted. */
  childModel?: LanguageModel;
  /** Send only headings to the supervisor/interpret; use find tool to locate content. */
  lightweight?: boolean;
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

/** Edit via the coder agent (JS node manipulations on a Lexical session). */
export const editViaCode: EditMethod = async (snapshot, request, model, commit, opts = {}) => {
  const session = createEditingSession();
  loadSnapshot(session, snapshot);
  const { totalUsage } = await runAgent(
    session,
    request,
    () => commit(toSnapshot(session)),
    model,
    { reportDiff: opts.reportDiff, interpret: opts.interpret, childModel: opts.childModel }
  );
  return {
    inputTokens: totalUsage.inputTokens ?? 0,
    outputTokens: totalUsage.outputTokens ?? 0,
  };
};

/** Edit via a shell agent operating on the document as XML in a temp file. */
export const editViaXml: EditMethod = async (snapshot, request, model, commit, opts = {}) => {
  const tmp = path.join(os.tmpdir(), `doc-${process.pid}-${Date.now()}.xml`);
  fs.writeFileSync(tmp, toXml(snapshot));
  try {
    return await runBashAgent(tmp, request, model, commit, {
      reportDiff: opts.reportDiff,
      interpret: opts.interpret,
    });
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}.orig`, { force: true });
  }
};

export const METHODS: Record<string, EditMethod> = {
  code: editViaCode,
  xml: editViaXml,
};
