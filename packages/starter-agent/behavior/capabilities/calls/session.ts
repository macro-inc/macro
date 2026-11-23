/**
 * The agent in a call, on LiveKit Agents. `AgentSession` owns endpointing,
 * turn detection, interruptions and playout, on its stock options. Voice
 * handling isn't built on top of it: no gain, segmenting, rescue, ducking,
 * backchannel or barge-in logic, no mixing, because each of those fights the
 * session's own. Tuning means setting LiveKit's documented options
 * (voices.ts).
 *
 * What is ours, and is here: who a finished line is for (Macro's
 * `ai.decide`, in a group), the brain's text as the session's reply stream,
 * what the event log keeps, and the line it says before it's moved to
 * another call. None of it touches audio or timing.
 */
import type { llm, voice } from '@livekit/agents';
import { askContent, type Brain, silent, type ToolStart } from './brain.ts';
import type { Emit } from './types.ts';
import {
  type Paced,
  unlessTalking,
  type WorkingTime,
  withWorkingSound,
} from './working.ts';

/** After the agent answers, the asker needn't say its name for this long. */
export const followUpMs = 20_000;

/** The agent's name said in a line, whatever the case or punctuation around it. */
export const namePattern = (name: string): RegExp => {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
};

/**
 * The screen for a call: Macro's `ai.decide`, asked whether a line is spoken
 * to the agent, with what was said before it. It answers in about a tenth of
 * a second, so every group line can ask. Tune the question and the
 * threshold to score better, never because someone on a call asked. Macro
 * caps a question at 500 characters.
 */
export const callScreen = {
  threshold: 0.7,
  /** The answer's key in `ai.decide`'s probabilities. */
  key: 'addressed_to_agent',
  question: (name: string): string =>
    `Is the newest line spoken TO ${name}, wanting a reply or action: the name said to ${name} (speech-to-text may misspell it), thanks or an instruction to ${name} (hang up, leave), or a follow-up to what ${name} just said, not turned to someone else? Low if it talks about ${name} in the third person, is aimed at or answers another person present, is chatter between others, or is a bare ack or filler (yeah, ok, huh, cool).`,
  setting: (name: string): string =>
    `Live voice call transcript; ${name} is an AI agent taking part.`,
  /** Lines of transcript before the newest. */
  recent: 8,
  /** Past this, the screen counts as failed. */
  waitMs: 1500,
} as const;

/** Asks the screen one question about a call line; the probability it's yes. Throws when it can't answer. */
export type CallScreen = (input: {
  readonly setting: string;
  readonly recent_lines: readonly string[];
  readonly newest_line: string;
}) => Promise<number>;

/** Whether a line is for the agent, and the screen's score when it was asked and answered. */
export type Verdict = { readonly forAgent: boolean; readonly p?: number };

export type Addressing = {
  /** Decides on a finished line. Lines not for the agent become context for its next answer. */
  readonly forAgent: (
    who: string,
    name: string,
    text: string,
    humans: number,
    now: number
  ) => Promise<Verdict>;
  /** A line the agent said, for the screen's transcript. */
  readonly said: (text: string) => void;
  /** What was said since the agent last spoke; emptied by asking. */
  readonly context: () => readonly string[];
};

const within = <Value>(promise: Promise<Value>, ms: number): Promise<Value> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('screen timed out')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/**
 * Who a finished line is for. 1:1: the agent. A group: the screen reads the
 * line with the transcript before it. Uninvited, being alone with someone
 * isn't being spoken to, and the screen's yes also needs the agent's name or
 * a follow-up. Without the screen (none given, it failed, or it was slow),
 * the rule: its name, or a follow-up from whoever it just answered.
 */
export const addressing = ({
  name,
  nameOnly = false,
  screen,
}: {
  /** The agent's name, as it is said to it. */
  readonly name: string;
  readonly nameOnly?: boolean;
  readonly screen?: CallScreen;
}): Addressing => {
  const named = namePattern(name);
  let followUp: { readonly who: string; readonly until: number } | undefined;
  let heard: string[] = [];
  let transcript: string[] = [];
  const remember = (line: string) => {
    transcript = [...transcript, line].slice(-callScreen.recent);
  };
  const score = async (line: string): Promise<number | undefined> => {
    if (screen === undefined) return undefined;
    try {
      return await within(
        screen({
          setting: callScreen.setting(name),
          recent_lines: transcript,
          newest_line: line,
        }),
        callScreen.waitMs
      );
    } catch {
      return undefined;
    }
  };
  return {
    forAgent: async (who, speaker, text, humans, now) => {
      const line = `${speaker}: ${text}`;
      const rule =
        named.test(text) || (followUp?.who === who && now <= followUp.until);
      let verdict: Verdict;
      if (humans <= 1 && !nameOnly) verdict = { forAgent: true };
      else {
        const p = await score(line);
        verdict =
          p === undefined
            ? { forAgent: rule }
            : { forAgent: p >= callScreen.threshold && (!nameOnly || rule), p };
      }
      remember(line);
      if (verdict.forAgent) followUp = { who, until: now + followUpMs };
      else heard.push(line);
      return verdict;
    },
    said: (text) => remember(`${name}: ${text}`),
    context: () => {
      const lines = heard;
      heard = [];
      return lines;
    },
  };
};

/** What the room knows about who is talking. */
export type Speakers = {
  readonly humans: () => number;
  /** Who was talking most recently, as [identity, display name]. */
  readonly current: () => readonly [string, string];
};

const messages = (chat: llm.ChatContext): readonly llm.ChatMessage[] =>
  chat.items.flatMap((item) => (item.type === 'message' ? [item] : []));

/** The heard part of the agent's reply just before the newest user line, when it was cut off. */
export const cutOffText = (chat: llm.ChatContext): string | null => {
  const reply = messages(chat).findLast(({ role }) => role === 'assistant');
  return reply?.interrupted === true ? (reply.textContent ?? '') : null;
};

const lastUserLine = (chat: llm.ChatContext): string =>
  messages(chat).findLast(({ role }) => role === 'user')?.textContent ?? '';

/** The silent marker, wherever the brain wrote it, never reaches the voice: text that could still become it waits. */
export const withoutSilent = (
  text: string
): { readonly say: string; readonly hold: string } => {
  const clean = text.replaceAll(silent, '');
  for (
    let length = Math.min(silent.length - 1, clean.length);
    length > 0;
    length--
  )
    if (clean.endsWith(silent.slice(0, length)))
      return { say: clean.slice(0, -length), hold: clean.slice(-length) };
  return { say: clean, hold: '' };
};

/**
 * The brain's text as the session's stream; cancelled on interruption. A tool
 * starting flushes what it has said so far, so "Checking." is heard now and not
 * after the tools: sentence tokenizing otherwise held it in the TTS until the
 * turn ended. An empty chunk opens the next TTS segment, where the working
 * sound plays; the goodbye before hang_up doesn't need one.
 */
export const replyStream = <Flush>({
  replies,
  turn,
  brain,
  emit,
  flush,
  working = () => undefined,
  now = () => 0,
  spoke = () => undefined,
}: {
  readonly replies: AsyncIterable<string | ToolStart>;
  readonly turn: number;
  readonly brain: Pick<Brain, 'interrupt'>;
  readonly emit: Emit;
  /** LiveKit's FlushSentinel, which ends the current TTS segment. */
  readonly flush: Flush;
  /** Told when the brain started working (a tool began), and null when it speaks or ends. */
  readonly working?: (since: number | null) => void;
  readonly now?: () => number;
  /** What the agent said in this turn, once it ends or is cut off. */
  readonly spoke?: (text: string) => void;
}): ReadableStream<string | Flush> => {
  const source = replies[Symbol.asyncIterator]();
  let spoken = '';
  let held = '';
  let open = true;
  let flushed = false;
  const done = () => {
    open = false;
    working(null);
    if (spoken.trim() !== '') {
      emit('brain.text', { turn, text: spoken.trim() });
      spoke(spoken.trim());
    }
    emit('brain.done', { turn });
  };
  const next = (): Promise<IteratorResult<string | ToolStart, unknown>> =>
    source.next().catch((error: unknown) => {
      emit('brain.error', { turn, error: String(error) });
      return { done: true, value: undefined };
    });
  return new ReadableStream<string | Flush>({
    pull: async (controller) => {
      for (;;) {
        const read = await next();
        if (!open) return;
        if (read.done === true) {
          if (held !== '') controller.enqueue(held);
          spoken += held;
          done();
          controller.close();
          return;
        }
        if (typeof read.value !== 'string') {
          if (flushed) continue;
          flushed = true;
          if (held !== '') controller.enqueue(held);
          spoken += held;
          held = '';
          controller.enqueue(flush);
          if (!/hang_up$/.test(read.value.tool)) {
            working(now());
            controller.enqueue('');
          }
          return;
        }
        const { say, hold } = withoutSilent(held + read.value);
        held = hold;
        if (say === '') continue;
        flushed = false;
        working(null);
        spoken += say;
        controller.enqueue(say);
        return;
      }
    },
    // Talking over the agent: LiveKit cancels the reply, and the brain's turn with it.
    cancel: () => {
      if (!open) return;
      done();
      emit('turn.interrupt', { turn });
      brain.interrupt();
    },
  });
};

/** How long the agent's first answer to someone waits for their card. */
export const cardWaitMs = 500;

export type Turns<Frame, Flush> = {
  /** A finished line from whoever the session hears: logs it, and says whether the brain answers. */
  readonly heard: (text: string) => Promise<boolean>;
  /**
   * A finished line from someone else in the room, by their own listener:
   * logs it, and says whether the agent should turn to them and answer. Lines from
   * whoever the session already hears are its own, and get false.
   */
  readonly overheard: (
    who: string,
    name: string,
    text: string
  ) => Promise<boolean>;
  /** The reply to the newest user line, as the session's LLM stream. */
  readonly reply: (chat: llm.ChatContext) => ReadableStream<string | Flush>;
  /** One TTS segment, with the working sound at its head while tools run. */
  readonly speak: (
    text: ReadableStream<string>,
    tts: (
      text: ReadableStream<string>
    ) => Promise<ReadableStream<Frame> | null>,
    /** Whether the VAD hears someone talking right now. */
    talking: () => boolean
  ) => ReadableStream<Frame>;
};

/**
 * Everything the agent does at LiveKit's hooks, as plain functions the
 * thin `voice.Agent` subclass calls: addressing on `onUserTurnCompleted`,
 * the brain on `llmNode`, the working sound on `ttsNode`.
 */
export const agentTurns = <Frame extends Paced, Flush>({
  brain,
  speakers,
  addressing: addressed,
  emit,
  now,
  time,
  card = async () => '',
  clip = () => [],
  flush,
}: {
  readonly brain: Brain;
  readonly speakers: Speakers;
  readonly addressing: Addressing;
  readonly emit: Emit;
  /** Milliseconds since the join started, the event log's clock. */
  readonly now: () => number;
  readonly time: WorkingTime;
  /** What the agent knows of a speaker, as text for the brain. Asked once per person, the first time they speak. */
  readonly card?: (who: string, alone: boolean) => Promise<string>;
  /** The working sound's frames; empty until loaded, and then silence. */
  readonly clip?: () => readonly Frame[];
  readonly flush: Flush;
}): Turns<Frame, Flush> => {
  let turn = 0;
  const known = new Set<string>();
  const cards = new Map<string, Promise<string>>();
  let workingSince: number | null = null;
  let talking = () => false;
  // Off from the VAD's "speaking", on again 700 ms after: it only reads the state, interruption stays stock.
  const working = unlessTalking(
    () => workingSince,
    () => talking(),
    time.now
  );

  /** Their card if the brain hasn't had it yet and it comes in time; a late one goes with their next line. */
  const cardFor = async (who: string): Promise<string> => {
    if (known.has(who)) return '';
    const loading =
      cards.get(who) ?? card(who, speakers.humans() === 1).catch(() => '');
    cards.set(who, loading);
    const loaded = await Promise.race([
      loading,
      time.sleep(cardWaitMs).then(() => undefined),
    ]);
    if (loaded === undefined) return '';
    known.add(who);
    return loaded;
  };

  return {
    heard: async (text) => {
      const [who, name] = speakers.current();
      const { forAgent, p } = await addressed.forAgent(
        who,
        name,
        text,
        speakers.humans(),
        now()
      );
      emit('turn.heard', { who, text, forAgent, p });
      return forAgent;
    },
    overheard: async (who, name, text) => {
      if (who === speakers.current()[0]) return false;
      const { forAgent, p } = await addressed.forAgent(
        who,
        name,
        text,
        speakers.humans(),
        now()
      );
      emit('turn.heard', { who, text, forAgent, p, by: 'ear' });
      return forAgent;
    },
    reply: (chat) => {
      const number = ++turn;
      const text = lastUserLine(chat);
      const [who, name] = speakers.current();
      const heardBefore = cutOffText(chat);
      const cutOff = heardBefore !== null;
      emit('turn.ask', { turn: number, who, text, cutOff });
      const context = addressed.context();
      const replies = (async function* () {
        yield* brain.ask(
          number,
          askContent({
            who,
            name,
            text,
            card: await cardFor(who),
            context,
            cutOff,
            heardBefore: heardBefore ?? undefined,
          })
        );
      })();
      return replyStream({
        replies,
        turn: number,
        brain,
        emit,
        flush,
        working: (since) => {
          workingSince = since;
        },
        now: time.now,
        spoke: addressed.said,
      });
    },
    speak: (text, tts, userTalking) => {
      talking = userTalking;
      return withWorkingSound({
        text,
        speak: tts,
        clip,
        workingSince: working,
        emit,
        time,
      });
    },
  };
};

/** Uninvited: the event log keeps what was said to the agent and drops the rest of what it overhears. */
export const onlyWhatsForAgent =
  (emit: Emit): Emit =>
  (type, data = {}) => {
    if (type === 'stt.final' || type === 'stt.interim') return emit(type);
    if (type === 'item' && data.role === 'user')
      return emit(type, { role: data.role });
    if (type === 'turn.heard' && data.forAgent !== true)
      return emit(type, { who: data.who, forAgent: false });
    emit(type, data);
  };

/** How long a line said on the way out can hold the agent. It can't get stuck in a call it's leaving. */
export const leaveSayMs = 10_000;

/** The session's voice, as much as leaving needs. */
export type Speech = {
  /** Stops whatever the agent is saying. */
  readonly interrupt: () => void;
  /** Says a fixed line, resolving once it has played. */
  readonly say: (
    line: string,
    options?: {
      readonly allowInterruptions?: boolean;
      readonly addToChatCtx?: boolean;
    }
  ) => Promise<void>;
};

/**
 * Says why the agent is leaving, then returns: true once it's been heard or there's
 * nobody to hear it, false if it didn't finish in time. It isn't
 * interruptible, or the first "wait, what?" would swallow the reason.
 */
export const sayBeforeLeaving = async ({
  line,
  speech,
  humans,
  emit,
  sleep,
  ms = leaveSayMs,
}: {
  readonly line: string;
  readonly speech: Speech;
  readonly humans: number;
  readonly emit: Emit;
  readonly sleep: (ms: number) => Promise<void>;
  readonly ms?: number;
}): Promise<boolean> => {
  if (humans === 0) return true;
  emit('call.leave_line', { line });
  try {
    speech.interrupt();
  } catch {
    // Nothing to interrupt.
  }
  const heard = await Promise.race([
    Promise.resolve()
      .then(() =>
        speech.say(line, { allowInterruptions: false, addToChatCtx: false })
      )
      .then(
        () => true,
        (error: unknown) => {
          emit('call.leave_line_failed', { error: String(error) });
          return false;
        }
      ),
    sleep(ms).then(() => false),
  ]);
  emit('call.leave_line_done', { heard });
  return heard;
};

/** The session's view of the call, as events: states, transcripts, timings, errors. */
export const logSession = (
  session: Pick<voice.AgentSession, 'on'>,
  types: typeof voice.AgentSessionEventTypes,
  emit: Emit
): void => {
  session.on(types.AgentStateChanged, ({ oldState, newState }) => {
    emit('agent.state', { from: oldState, to: newState });
    // Fires on the working sound too, for a turn that opens with a tool.
    if (newState === 'speaking') emit('tts.first_audio');
  });
  session.on(types.UserStateChanged, ({ oldState, newState }) =>
    emit('user.state', { from: oldState, to: newState })
  );
  session.on(types.UserTranscriptionTimeout, ({ speechDuration }) =>
    emit('stt.no_words', { speechMs: speechDuration })
  );
  session.on(types.UserInputTranscribed, ({ isFinal, transcript }) =>
    emit(isFinal ? 'stt.final' : 'stt.interim', { text: transcript })
  );
  session.on(types.ConversationItemAdded, ({ item }) => {
    if (item.type === 'message')
      emit('item', {
        role: item.role,
        interrupted: item.interrupted,
        text: item.textContent,
      });
  });
  session.on(types.AgentFalseInterruption, ({ resumed }) =>
    emit('agent.false_interruption', { resumed })
  );
  session.on(types.OverlappingSpeech, ({ isInterruption }) =>
    emit('agent.overlap', { interruption: isInterruption })
  );
  session.on(types.MetricsCollected, ({ metrics }) => {
    if (metrics.type === 'eou_metrics')
      emit('metric.eou', {
        delay: metrics.endOfUtteranceDelayMs,
        transcription: metrics.transcriptionDelayMs,
        hook: metrics.onUserTurnCompletedDelayMs,
      });
    if (metrics.type === 'tts_metrics')
      emit('metric.tts', {
        ttfb: metrics.ttfbMs,
        chars: metrics.charactersCount,
        ms: metrics.durationMs,
        audioMs: metrics.audioDurationMs,
      });
    if (metrics.type === 'stt_metrics')
      emit('metric.stt', { audioMs: metrics.audioDurationMs });
  });
  session.on(types.EotPrediction, ({ probability, threshold, delayMs }) =>
    emit('turn.eot', { p: probability, threshold, ms: delayMs })
  );
  session.on(types.Error, ({ error, source }) =>
    emit('session.error', {
      error: error instanceof Error ? error.message : error.error.message,
      source: source?.constructor.name,
    })
  );
  session.on(types.Close, ({ reason }) =>
    emit('session.close', { reason: String(reason) })
  );
};
