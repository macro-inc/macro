import SHARED from '../prompts/SHARED.md';
import SUPERVISOR from '../prompts/SUPERVISOR.md';
import INTERPRET from '../prompts/INTERPRET.md';
import API_COMPACT from '../prompts/API_COMPACT.md';
import { type LanguageModel, generateText, stepCountIs } from 'ai';
import { type Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import { sharedPeerPool, type Peer } from '../awareness/peer-pool';
import { Doc } from '../doc/doc';
import type { DocumentOpQueueParams } from '../queue/types';
import type { RunCodeToolOptions } from '../tools/run-code';
import type { DocumentOp } from '../editor/ops';
import { numberLines, serializeWithIds, serializeWithXml } from '../utils';
import { type Counters, type Writer, createDispatchTool } from '../tools/dispatch';
import { createSearchContactsTool } from '../tools/search-contacts';
import { interpret } from './interpreter';
import { runTask } from './coder';

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}\n${API_COMPACT}`;
const INTERPRET_SYSTEM = `${SHARED}\n${INTERPRET}`;

/** Above this estimated document size, run the supervisor on the 1M-context
 *  fallback model. The supervisor re-sends the whole document on every step
 *  (initial prompt + each dispatch result echoes it), so a large doc multiplies
 *  fast and overflows a small provider window (e.g. Cerebras' 131k). */
const DOC_TOKEN_FALLBACK_THRESHOLD = 50_000;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ContactResult =
  | { kind: 'user'; userId: string; email: string; name?: string }
  | { kind: 'contact'; contactId: string; name: string; emailOrDomain: string; isCompany: boolean };

export type SearchContacts = (query: string) => Promise<ContactResult[]>;

export type RunAgentOptions = {
  /** Push the edited session out to the live document (mirror → Loro). Called
   *  after every applied edit so the user sees changes (and typing) stream in. */
  propagate: () => void;
  /** Build a writer's cursor identity. */
  makeAwareness: (name: string, color: string) => AwarenessSource;
  /** Resolve a name query to contact/user results. */
  searchContacts: SearchContacts;
  /** Model for the writer (child) agents; defaults to the supervisor model. */
  childModel?: LanguageModel;
  /** 1M-context model the supervisor falls back to when the document is large
   *  enough to risk overflowing the primary model's context window. Child
   *  writers keep using the primary model (they only see windowed context). */
  largeModel?: LanguageModel;
  /** Document serialization fed to the agents. Default 'xml'. */
  docFormat?: 'markdown' | 'xml';
  /** Run an intent-interpretation pass first. */
  interpret?: boolean;
  runner: RunCodeToolOptions['runner'];
  /** Animation tuning (speed, ranges). */
  params?: DocumentOpQueueParams;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  /** Collect every op batch as it is generated (before it is applied). */
  onOps?: (ops: DocumentOp[]) => void;
};

export async function runAgent(s: Session, request: string, model: LanguageModel, opts: RunAgentOptions) {
  const serialize =
    opts.docFormat === 'markdown' ? serializeWithIds : (sess: Session) => numberLines(serializeWithXml(sess));
  const counters: Counters = { inputTokens: 0, outputTokens: 0 };
  const doc = new Doc(s, opts.propagate);

  // One writer identity per dispatched edit. Borrow a unique peer (name/color)
  // for the writer's lifetime; concurrent writers never share a name. The pool is
  // process-global, so its concurrency cap bounds writers across all in-flight
  // turns — not just this one. Outstanding sources are tracked so the turn's
  // finally can clear stragglers (cursors + keep-alive timers).
  const outstanding = new Map<Peer, AwarenessSource>();
  const makeWriter = async (): Promise<Writer> => {
    const peer = await sharedPeerPool.borrow();
    const awarenessSource = opts.makeAwareness(peer.name, peer.color);
    outstanding.set(peer, awarenessSource);
    const release = () => {
      if (!outstanding.delete(peer)) return; // already released
      awarenessSource.clear();
      sharedPeerPool.release(peer);
    };
    return { awarenessSource, release };
  };

  const initialText = serialize(s);
  const docContext = `<document>\n${initialText}\n</document>`;

  // a pretty "dumb" probably awful estimate, but we lean on the side of caution on choosing a bigger model for huge documents
  // TODO(wolf): probably dont want to send the entire context anyway
  const estimatedDocTokens = Math.ceil(initialText.length / 4);
  const supervisorModel =
    opts.largeModel && estimatedDocTokens > DOC_TOKEN_FALLBACK_THRESHOLD ? opts.largeModel : model;

  let intent = '';
  if (opts.interpret) {
    const interpretation = await interpret(docContext, request, supervisorModel, INTERPRET_SYSTEM);
    counters.inputTokens += interpretation.totalUsage.inputTokens ?? 0;
    counters.outputTokens += interpretation.totalUsage.outputTokens ?? 0;
    intent = interpretation.text;
    console.log(`\n[intent]\n${intent}`);
    await delay(300);
  }

  const tools = {
    dispatch: createDispatchTool({
      s,
      doc,
      childModel: opts.childModel ?? model,
      counters,
      params: opts.params,
      typingAnimations: opts.typingAnimations,
      signal: opts.signal,
      makeWriter,
      runTask,
      serialize,
      runner: opts.runner,
      onOps: opts.onOps,
    }),
    searchContacts: createSearchContactsTool(opts.searchContacts),
  };

  const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
  const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

  try {
    const result = await generateText({
      model: supervisorModel,
      stopWhen: stepCountIs(10),
      system: MASTER_SYSTEM,
      prompt,
      tools,
      abortSignal: opts.signal,
    });
    counters.inputTokens += result.totalUsage.inputTokens ?? 0;
    counters.outputTokens += result.totalUsage.outputTokens ?? 0;
    return { text: result.text || 'Applied edits.', totalUsage: counters, steps: result.steps, intent };
  } finally {
    // Safety net: per-writer .finally(release) is the primary path; clean up
    // anything still outstanding (e.g. on abort/throw).
    for (const [peer, a] of outstanding) {
      a.clear();
      sharedPeerPool.release(peer);
    }
    outstanding.clear();
  }
}
