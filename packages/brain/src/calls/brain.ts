import {
  createSdkMcpServer,
  type Options,
  query,
  type SDKUserMessage,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Emit } from './events.ts';
export const SILENT = '(silent)';
export interface Brain {
  start(): Promise<void>;
  ask(turn: number, content: string): AsyncIterable<string>;
  interrupt(): void;
  close(): Promise<void>;
}
export type Asked = {
  who: string;
  name: string;
  text: string;
  context: string[];
  cutOff: boolean;
};
export function askContent(a: Asked): string {
  const parts: string[] = [];
  if (a.cutOff)
    parts.push('(Someone talked over you, so you stopped mid-answer.)');
  if (a.context.length)
    parts.push(
      `Said on the call since you last spoke:\n${a.context.join('\n')}`
    );
  parts.push(`${a.name} [${a.who}] says to you: ${a.text}`);
  return parts.join('\n\n');
}
export function sentences(buf: string): [string[], string] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]!;
    let end = -1;
    if (c === '\n') end = i;
    else if ('.!?'.includes(c)) {
      let j = i + 1;
      while (j < buf.length && '.!?"\')]'.includes(buf[j]!)) j++;
      // A sentence ends only at punctuation followed by whitespace ("5.5" doesn't).
      if (j < buf.length && /\s/.test(buf[j]!)) end = j - 1;
      else continue;
      i = j - 1;
    } else continue;
    const sentence = buf.slice(start, end + 1).trim();
    if (sentence) out.push(sentence);
    start = end + 1;
  }
  return [out, buf.slice(start)];
}
export function rules(): string {
  return `You are on a live voice call. Everything you write is spoken aloud,
  sentence by sentence. Use one or two short sentences, then let others talk.
  No lists, markdown, URLs, secrets, identifiers or file paths. If you need a
  tool, say a few words first. Speech recognition can mangle words and names.
  If a line was not meant for you, reply exactly "${SILENT}".
  If interrupted, answer the new question without repeating yourself.
  Your OPERATING.md authority and voice apply on this call too.
  Use hand_off for real work: it runs in your work tier and reports back after
  the call ends. Never promise work without handing it off. Say bye briefly
  and use hang_up when asked to leave.`;
}
export type CallBrainOptions = {
  callId: string;
  channel: string;
  emit: Emit;
  onHangUp: () => void;
  handOff(task: string): Promise<string>;
  briefing(): Promise<string>;
  operating: string;
  options: Options;
};
class Inbox implements AsyncIterable<SDKUserMessage> {
  private q: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(text: string) {
    this.q.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    });
    this.wake?.();
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.q.length) yield this.q.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}
type Out =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'end';
    };
export function claudeBrain(opts: CallBrainOptions): Brain {
  const { emit } = opts;
  const inbox = new Inbox();
  let sink: ((o: Out) => void) | null = null; // the running turn's consumer
  let chain: Promise<void> = Promise.resolve();
  let warming = false;
  let q: ReturnType<typeof query> | null = null;
  let ready!: () => void;
  const started = new Promise<void>((r) => (ready = r));
  const tools = createSdkMcpServer({
    name: 'call',
    version: '1.0.0',
    tools: [
      tool(
        'hang_up',
        'Leave this call now (after saying bye).',
        {},
        async () => {
          emit('brain.hang_up');
          setTimeout(opts.onHangUp, 1500); // let the goodbye play
          return { content: [{ type: 'text', text: 'Leaving the call.' }] };
        },
        { alwaysLoad: true }
      ),
      tool(
        'hand_off',
        'Give real work (deploys, code, PRs, signups, research, anything over a minute) to a detached run of you that keeps going after this call ends and messages the asker when done.',
        { task: z.string().describe('The task, who asked, and their words.') },
        async ({ task }) => {
          try {
            const log = await opts.handOff(task);
            return {
              content: [
                {
                  type: 'text',
                  text: `Handed off; running detached (log ${log}).`,
                },
              ],
            };
          } catch (e) {
            return {
              content: [{ type: 'text', text: `Hand-off failed: ${e}` }],
              isError: true,
            };
          }
        },
        { alwaysLoad: true } // deferred, the brain spent 5 s on ToolSearch before hanging up (probe 01a1a217)
      ),
    ],
  });
  async function pump() {
    let buf = '';
    for await (const m of q!) {
      if (m.type === 'stream_event') {
        const ev = m.event as {
          type: string;
          delta?: {
            type: string;
            text?: string;
          };
        };
        if (
          ev.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta'
        ) {
          buf += ev.delta.text ?? '';
          const [done, rest] = sentences(buf);
          buf = rest;
          for (const s of done) sink?.({ kind: 'text', text: s });
        } else if (ev.type === 'content_block_stop' && buf.trim()) {
          sink?.({ kind: 'text', text: buf.trim() });
          buf = '';
        }
      } else if (m.type === 'assistant') {
        for (const b of m.message.content)
          if (b.type === 'tool_use')
            emit('brain.tool', {
              name: b.name,
              input: JSON.stringify(b.input).slice(0, 300),
            });
      } else if (m.type === 'result') {
        if (buf.trim()) sink?.({ kind: 'text', text: buf.trim() });
        buf = '';
        emit('brain.result', {
          subtype: m.subtype,
          ms: m.duration_ms,
          cost: m.total_cost_usd,
        });
        sink?.({ kind: 'end' });
      } else if (m.type === 'system' && m.subtype === 'init') {
        emit('brain.init', { model: m.model, session: m.session_id });
      }
    }
    emit('brain.exit');
    sink?.({ kind: 'end' });
  }
  function runTurn(content: string, turnNo: number) {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const t0 = performance.now();
    let first = true;
    sink = (o) => {
      if (o.kind === 'end') {
        ended = true;
        sink = null;
        finish();
      } else {
        if (first)
          emit('brain.first_text', {
            turn: turnNo,
            ms: Math.round(performance.now() - t0),
          });
        first = false;
        queue.push(o.text);
      }
      wake?.();
    };
    inbox.push(content);
    async function* texts(): AsyncGenerator<string> {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    }
    return { texts: texts(), done };
  }
  async function* serial(
    content: string,
    turnNo: number
  ): AsyncGenerator<string> {
    let release!: () => void;
    const prev = chain;
    chain = new Promise<void>((r) => (release = r));
    await prev;
    const t = runTurn(content, turnNo);
    t.done.then(release);
    yield* t.texts;
  }
  return {
    async start() {
      const brief = opts.briefing();
      q = query({
        prompt: inbox,
        options: {
          ...opts.options,
          includePartialMessages: true,
          settingSources: ['project'],
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: `${rules()}\n${opts.operating}`,
          },
          mcpServers: { call: tools },
          stderr: (s: string) =>
            emit('brain.stderr', { text: s.slice(0, 500) }),
        },
      });
      void pump().catch((e) => {
        emit('brain.error', { error: String(e) });
        sink?.({ kind: 'end' });
      });
      const t0 = performance.now();
      const warm = serial(
        `${await brief}\n\nYou joined call ${opts.callId} in channel ${opts.channel}. Reply exactly: ready`,
        0
      );
      warming = true;
      ready(); // asks may now queue behind the warm-up (and cut it short)
      for await (const _ of warm);
      warming = false;
      emit('brain.ready', { ms: Math.round(performance.now() - t0) });
    },
    async *ask(turnNo, content) {
      await started;
      if (warming) emit('brain.ask_waits_for_warmup');
      emit('brain.ask', { turn: turnNo });
      yield* serial(content, turnNo);
    },
    interrupt() {
      if (!q || !sink) return;
      emit('brain.interrupt');
      q.interrupt().catch((e) =>
        emit('brain.error', { error: `interrupt: ${e}` })
      );
    },
    async close() {
      inbox.end();
      try {
        q?.close?.();
      } catch (error) {
        emit('brain.close_error', { error: String(error) });
      }
    },
  };
}
