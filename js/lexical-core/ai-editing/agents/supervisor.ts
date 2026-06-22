import SHARED from '../prompts/SHARED.md';
import SUPERVISOR from '../prompts/SUPERVISOR.md';
import INTERPRET from '../prompts/INTERPRET.md';
import { type LanguageModel, generateText, stepCountIs } from 'ai';
import { type Session } from '../ai-toolkit';
import { type AwarenessSource, mockAwarenessSource } from '../awareness/awareness-source';
import { sharedPeerPool, type Peer } from '../awareness/peer-pool';
import { Doc } from '../doc/doc';
import type { DocumentOpQueueParams } from '../queue/document-op-queue';
import type { RunCodeToolOptions } from '../tools/run-code';
import type { DocumentOp } from '../editor/ops';
import { serializeWithIds, serializeWithXml } from '../utils';
import { type Counters, type Writer, createDispatchTool } from '../tools/dispatch';
import { interpret } from './interpreter';
import { runTask } from './coder';

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}`;
const INTERPRET_SYSTEM = `${SHARED}\n${INTERPRET}`;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RunAgentOptions = {
  /** Push the edited session out to the live document (mirror → Loro). Called
   *  after every applied edit so the user sees changes (and typing) stream in. */
  propagate: () => void;
  /** Build a writer's cursor identity. Omit for headless/no-cursor runs (mock). */
  makeAwareness?: (name: string, color: string) => AwarenessSource;
  /** Model for the writer (child) agents; defaults to the supervisor model. */
  childModel?: LanguageModel;
  /** Document serialization fed to the agents. Default 'xml'. */
  docFormat?: 'markdown' | 'xml';
  /** Run an intent-interpretation pass first. */
  interpret?: boolean;
  /** Animation tuning (speed, ranges). */
  params?: DocumentOpQueueParams;
  signal?: AbortSignal;
  /** Override the code runner (e.g. QuickJS sandbox). */
  runner?: RunCodeToolOptions['runner'];
  /** Collect every op batch as it is generated (before it is applied). */
  onOps?: (ops: DocumentOp[]) => void;
};

export async function runAgent(s: Session, request: string, model: LanguageModel, opts: RunAgentOptions) {
  const serialize = opts.docFormat === 'markdown' ? serializeWithIds : serializeWithXml;
  const counters: Counters = { inputTokens: 0, outputTokens: 0 };
  const doc = new Doc(s, opts.propagate);

  // One writer identity per dispatched edit. Borrow a unique peer (name/color)
  // for the writer's lifetime; concurrent writers never share a name. The pool is
  // process-global, so its concurrency cap bounds writers across all in-flight
  // turns — not just this one. Outstanding sources are tracked so the turn's
  // finally can clear stragglers (cursors + keep-alive timers).
  const pool = sharedPeerPool;
  const outstanding = new Map<Peer, AwarenessSource>();
  const makeWriter = async (): Promise<Writer> => {
    const peer = await pool.borrow();
    const awarenessSource = opts.makeAwareness ? opts.makeAwareness(peer.name, peer.color) : mockAwarenessSource();
    outstanding.set(peer, awarenessSource);
    const release = () => {
      if (!outstanding.delete(peer)) return; // already released
      awarenessSource.clear();
      pool.release(peer);
    };
    return { awarenessSource, release };
  };

  const docContext = `<document>\n${serialize(s)}\n</document>`;

  let intent = '';
  if (opts.interpret) {
    const interpretation = await interpret(docContext, request, model, INTERPRET_SYSTEM);
    counters.inputTokens += interpretation.totalUsage.inputTokens ?? 0;
    counters.outputTokens += interpretation.totalUsage.outputTokens ?? 0;
    intent = interpretation.text;
    console.log(`\n[intent]\n${intent}`);
    await delay(300);
  }

  const dispatch = createDispatchTool({
    s,
    doc,
    childModel: opts.childModel ?? model,
    counters,
    params: opts.params,
    signal: opts.signal,
    makeWriter,
    runTask,
    serialize,
    runner: opts.runner,
    onOps: opts.onOps,
  });

  const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
  const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

  try {
    const result = await generateText({
      model,
      stopWhen: stepCountIs(4),
      system: MASTER_SYSTEM,
      prompt,
      tools: { dispatch },
      abortSignal: opts.signal,
    });
    counters.inputTokens += result.totalUsage.inputTokens ?? 0;
    counters.outputTokens += result.totalUsage.outputTokens ?? 0;
    return { text: result.text || 'Applied edits.', totalUsage: counters };
  } finally {
    // Safety net: per-writer .finally(release) is the primary path; clean up
    // anything still outstanding (e.g. on abort/throw).
    for (const [peer, a] of outstanding) {
      a.clear();
      pool.release(peer);
    }
    outstanding.clear();
  }
}
