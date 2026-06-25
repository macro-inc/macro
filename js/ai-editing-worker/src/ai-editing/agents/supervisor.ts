import { generateText, hasToolCall, stepCountIs } from 'ai';
import type { ResolvedModels } from '../../run-edit';
import type { Session } from '../ai-toolkit';
import type { AwarenessSource } from '../awareness/awareness-source';
import type { Peer } from '../awareness/peer-pool';
import { Doc } from '../doc/doc';
import API_COMPACT from '../prompts/API_COMPACT.md';
import INTERPRET from '../prompts/INTERPRET.md';
import SHARED from '../prompts/SHARED.md';
import SUPERVISOR from '../prompts/SUPERVISOR.md';
import { TokenTracker } from '../token-tracker';
import { createDispatchTool, type Writer } from '../tools/dispatch';
import { createImBlockedTool } from '../tools/im-blocked';
import { numberLines, serializeWithXml } from '../utils';
import { coder } from './coder';
import { interpreter } from './interpreter';
import type { RunAgentOptions } from './types';

export type { RunAgentOptions } from './types';

const MASTER_SYSTEM = `${SHARED}\n${SUPERVISOR}\n${API_COMPACT}`;
const INTERPRET_SYSTEM = `${SHARED}\n${INTERPRET}`;

export async function supervisor(
  session: Session,
  request: string,
  models: ResolvedModels,
  opts: RunAgentOptions
) {
  const serialize = (sess: Session) => numberLines(serializeWithXml(sess));
  const tracker = new TokenTracker();
  const doc = new Doc(session, opts.propagate);

  const outstanding = new Map<Peer, AwarenessSource>();
  const makeWriter = async (): Promise<Writer> => {
    const peer = await opts.peerPool.borrow();
    const awarenessSource = opts.makeAwareness(peer.name, peer.color);
    outstanding.set(peer, awarenessSource);
    const release = () => {
      if (!outstanding.delete(peer)) return;
      awarenessSource.clear();
      opts.peerPool.release(peer);
    };
    return { awarenessSource, release };
  };

  const initialText = serialize(session);
  const docContext = `<document>\n${initialText}\n</document>`;

  let intent = '';
  if (opts.interpret) {
    const interpretation = await interpreter(
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
    reportBlocked: createImBlockedTool(
      'Call this when you cannot proceed without more information or when the task is impossible.',
      true
    ),
    dispatch: createDispatchTool({
      session,
      doc,
      childModel: models.coding,
      tracker,
      params: opts.params,
      typingAnimations: opts.typingAnimations,
      signal: opts.signal,
      makeWriter,
      runTask: coder,
      serialize,
      runner: opts.runner,
      onOps: opts.onOps,
      onCoderResult: opts.onCoderResult,
    }),
  };

  const intentBlock = intent ? `<intent>\n${intent}\n</intent>\n\n` : '';
  const prompt = `Request: ${request}\n\n${intentBlock}${docContext}`;

  try {
    const result = await generateText({
      model: models.supervisor,
      stopWhen: [stepCountIs(12), hasToolCall('reportBlocked')],
      system: MASTER_SYSTEM,
      prompt,
      tools,
      abortSignal: opts.signal,
    });
    tracker.add(models.supervisor as { modelId: string }, result.totalUsage);

    const blocked = result.steps
      .flatMap((s) => s.toolCalls)
      .find((c) => c.toolName === 'reportBlocked');
    const clarification = (blocked?.input as { message: string } | undefined)
      ?.message;

    return {
      text: result.text || 'Applied edits.',
      totalUsage: tracker,
      steps: result.steps,
      intent,
      clarification,
    };
  } finally {
    for (const [peer, a] of outstanding) {
      a.clear();
      opts.peerPool.release(peer);
    }
    outstanding.clear();
  }
}
