import { generateText, stepCountIs } from 'ai';
import type { ResolvedModels } from '../../run-edit';
import type { Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import { type Peer, sharedPeerPool } from '../awareness/peer-pool';
import { Doc } from '../doc/doc';
import type { DocumentOp } from '../editor/ops';
import API_COMPACT from '../prompts/API_COMPACT.md';
import INTERPRET from '../prompts/INTERPRET.md';
import SHARED from '../prompts/SHARED.md';
import SUPERVISOR from '../prompts/SUPERVISOR.md';
import type { DocumentOpQueueParams } from '../queue/types';
import { TokenTracker } from '../token-tracker';
import { createDispatchTool, type Writer } from '../tools/dispatch';
import type { RunCodeToolOptions } from '../tools/run-code';
import { createSearchContactsTool } from '../tools/search-contacts';
import { numberLines, serializeWithIds, serializeWithXml } from '../utils';
import { runTask } from './coder';
import { interpret } from './interpreter';

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}\n${API_COMPACT}`;
const INTERPRET_SYSTEM = `${SHARED}\n${INTERPRET}`;


export type ContactResult =
  | { kind: 'user'; userId: string; email: string; name?: string }
  | {
      kind: 'contact';
      contactId: string;
      name: string;
      emailOrDomain: string;
      isCompany: boolean;
    };

export type SearchContacts = (query: string) => Promise<ContactResult[]>;

export type RunAgentOptions = {
  /** Push the edited session out to the live document (mirror → Loro). Called
   *  after every applied edit so the user sees changes (and typing) stream in. */
  propagate: () => void;
  /** Build a writer's cursor identity. */
  makeAwareness: (name: string, color: string) => AwarenessSource;
  /** Resolve a name query to contact/user results. */
  searchContacts: SearchContacts;
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

export async function runAgent(
  s: Session,
  request: string,
  models: ResolvedModels,
  opts: RunAgentOptions
) {
  const serialize =
    opts.docFormat === 'markdown'
      ? serializeWithIds
      : (sess: Session) => numberLines(serializeWithXml(sess));
  const tracker = new TokenTracker();
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

  let intent = '';
  if (opts.interpret) {
    const interpretation = await interpret(
      docContext,
      request,
      models.interpret,
      INTERPRET_SYSTEM
    );
    tracker.add(
      models.interpret as { modelId: string },
      interpretation.totalUsage
    );
    intent = interpretation.text;
    console.log(`\n[intent]\n${intent}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const tools = {
    dispatch: createDispatchTool({
      s,
      doc,
      childModel: models.coding,
      tracker,
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
      model: models.supervisor,
      stopWhen: stepCountIs(10),
      system: MASTER_SYSTEM,
      prompt,
      tools,
      abortSignal: opts.signal,
    });
    tracker.add(models.supervisor as { modelId: string }, result.totalUsage);
    return {
      text: result.text || 'Applied edits.',
      totalUsage: tracker,
      steps: result.steps,
      intent,
    };
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
