/**
 * LiveKit, for real: the only module that constructs its objects. It is
 * imported lazily (`context/voice.ts`), because loading it loads LiveKit's
 * native libraries, which only a call's own process should pay for.
 *
 * Everything here is thin: the session's options are `voices.ts`, what the
 * agent does at each hook is `session.ts`, what the room observer does is
 * `room.ts`.
 */
import {
  audioFramesFromFile,
  FlushSentinel,
  inference,
  initializeLogger,
  llm,
  voice,
} from '@livekit/agents';
import {
  AudioFrame,
  AudioStream,
  dispose,
  type Participant,
  ParticipantKind,
  type Room,
  type Track,
  TrackKind,
  type TrackPublication,
} from '@livekit/rtc-node';
import type { Brain } from '../brain.ts';
import type { CallKit, CallSession, SessionNeeds } from '../join.ts';
import type { ReplaySession } from '../replay.ts';
import { replaySpeakers } from '../replay.ts';
import {
  frameMs,
  inRate,
  type Member,
  observeRoom,
  type Publication,
  type RoomFeed,
} from '../room.ts';
import { addressing, agentTurns, logSession, type Turns } from '../session.ts';
import type { Emit } from '../types.ts';
import { sessionOptions, type Voice } from '../voices.ts';
import { clipFrameMs, clipFrames, type WorkingTime } from '../working.ts';
import { gatewayStt, gatewayTts, type SpeechRelay } from './speech.ts';

/**
 * The session won't reply without an LLM object. Replies come from
 * `VoiceAgent.llmNode`, so this is never called. A class because LiveKit's
 * `llm.LLM` is abstract and the session wants an instance of it.
 */
export class ClaudeCodeLlm extends llm.LLM {
  override label(): string {
    return 'claude-code';
  }
  override chat(): llm.LLMStream {
    throw new Error('replies come from VoiceAgent.llmNode');
  }
}

const streamOf = <Value>(
  source: AsyncIterable<Value>
): ReadableStream<Value> => {
  const values = source[Symbol.asyncIterator]();
  return new ReadableStream<Value>({
    pull: async (controller) => {
      const read = await values.next();
      if (read.done === true) controller.close();
      else controller.enqueue(read.value);
    },
    cancel: async () => {
      await values.return?.();
    },
  });
};

type AgentTurns = Turns<AudioFrame, FlushSentinel>;

/**
 * The agent as LiveKit's agent. A class because the session takes a
 * `voice.Agent` and calls these overrides; each one only hands over to
 * `session.ts`.
 */
export class VoiceAgent extends voice.Agent {
  readonly #turns: AgentTurns;
  constructor(turns: AgentTurns) {
    super({
      instructions:
        'The real instructions live in the Claude Code session (brain.ts).',
    });
    this.#turns = turns;
  }

  /** Addressing: a line that isn't for the agent gets no reply. */
  override async onUserTurnCompleted(
    _chat: llm.ChatContext,
    message: llm.ChatMessage
  ): Promise<void> {
    if (!(await this.#turns.heard(message.textContent ?? '')))
      throw new voice.StopResponse();
  }

  override async llmNode(chat: llm.ChatContext) {
    return this.#turns.reply(chat);
  }

  /** The stock TTS, with the working sound at the head of a segment while tools run. */
  override async ttsNode(
    text: ReadableStream<string> | AsyncIterable<string>,
    settings: voice.ModelSettings
  ) {
    return this.#turns.speak(
      text instanceof ReadableStream ? text : streamOf(text),
      (rest) => voice.Agent.default.ttsNode(this, rest, settings),
      () => this.session.userState === 'speaking'
    );
  }
}

/**
 * One person's listener: LiveKit's own hearing (STT, VAD, turn detection) on
 * their microphone, with no voice and no brain. Each finished line goes to
 * `line`; nothing is ever answered here.
 */
class EarAgent extends voice.Agent {
  readonly #line: (text: string) => void;
  constructor(line: (text: string) => void) {
    super({ instructions: 'Listens only.' });
    this.#line = line;
  }

  override async onUserTurnCompleted(
    _chat: llm.ChatContext,
    message: llm.ChatMessage
  ): Promise<void> {
    const text = message.textContent ?? '';
    if (text.trim() !== '') this.#line(text);
    throw new voice.StopResponse();
  }
}

/** A listener, once its session is up. */
type Ear = {
  readonly push: (frame: Int16Array) => void;
  readonly close: () => Promise<void>;
};

/** A recording as the session's microphone. A class because the session's input must extend `voice.AudioInput`. */
class FedInput extends voice.AudioInput {
  readonly #frames = new TransformStream<AudioFrame, AudioFrame>();
  readonly #writer = this.#frames.writable.getWriter();
  constructor() {
    super();
    this.multiStream.addInputStream(this.#frames.readable);
  }
  push(frame: Int16Array, rate: number): void {
    void this.#writer
      .write(new AudioFrame(frame, rate, 1, frame.length))
      .catch(() => undefined);
  }
}

const member = (participant: Participant): Member => ({
  identity: participant.identity,
  name: participant.name ?? '',
  kind: participant.kind,
  human: participant.kind !== ParticipantKind.AGENT,
});

const publication = (published: TrackPublication): Publication<Track> => ({
  sid: published.sid ?? '',
  audio: published.kind === TrackKind.KIND_AUDIO,
  kind: published.kind,
  source: published.source,
  muted: published.muted ?? false,
  track: published.track,
});

/** A connected LiveKit room as the observer reads it. */
export const roomFeed = (room: Room): RoomFeed<Track> => ({
  identity: () => room.localParticipant?.identity,
  members: () =>
    [...room.remoteParticipants.values()].map((participant) => ({
      ...member(participant),
      publications: [...participant.trackPublications.values()].map(
        publication
      ),
    })),
  listen: (listener) => {
    room.on('participantConnected', (participant) =>
      listener.joined(member(participant))
    );
    room.on('participantDisconnected', (participant) =>
      listener.left(member(participant))
    );
    room.on('localTrackPublished', (published) =>
      listener.ownTrack(publication(published))
    );
    room.on('trackPublished', (published, participant) =>
      listener.published(publication(published), member(participant))
    );
    room.on('trackSubscribed', (track, published, participant) =>
      listener.subscribed(
        { ...publication(published), track },
        member(participant)
      )
    );
    room.on('trackUnsubscribed', (_track, published, participant) =>
      listener.unsubscribed(published.sid ?? '', member(participant))
    );
    room.on('trackSubscriptionFailed', (sid, participant, reason) =>
      listener.subscriptionFailed(sid, member(participant), reason)
    );
    room.on('trackMuted', (published, participant) =>
      listener.muted(published.sid ?? '', participant.identity, true)
    );
    room.on('trackUnmuted', (published, participant) =>
      listener.muted(published.sid ?? '', participant.identity, false)
    );
    room.on('activeSpeakersChanged', (speakers) =>
      listener.speakers(speakers.map(({ identity }) => identity))
    );
    room.on('reconnecting', () => listener.reconnecting());
    room.on('reconnected', () => listener.reconnected());
    room.on('disconnected', (reason) => listener.disconnected(String(reason)));
  },
  frames: async function* (track) {
    const reader = new AudioStream(track, {
      sampleRate: inRate,
      numChannels: 1,
      frameSizeMs: frameMs,
    }).getReader();
    for (;;) {
      const read = await reader.read();
      if (read.done) return;
      yield read.value;
    }
  },
  disconnect: () => room.disconnect(),
});

export type LiveNeeds = {
  /** The relay the speech sockets open on: this process holds no key. */
  readonly relay: SpeechRelay;
  readonly voice: Voice;
  /** The agent's name, which speech-to-text is told so it spells it right. */
  readonly name: string;
  readonly time: WorkingTime;
  /** LiveKit's own log level. */
  readonly logLevel?: string;
};

/** Everything a call and a replay take from LiveKit. */
export type Live = CallKit & {
  /** The real session with no voice and a microphone fed by hand, for a replay. */
  readonly replaySession: (needs: {
    readonly brain: Brain;
    readonly emit: Emit;
    readonly now: () => number;
  }) => Promise<ReplaySession>;
};

const defaultLogLevel = 'warn';

export const live = ({
  relay,
  voice: spoken,
  name,
  time,
  logLevel = defaultLogLevel,
}: LiveNeeds): Live => {
  initializeLogger({ pretty: false, level: logLevel });

  /** The session every call runs. Without a voice it only listens, as a replay and a listener do. */
  const makeSession = async (
    options = { voice: true }
  ): Promise<voice.AgentSession> =>
    new voice.AgentSession({
      stt: gatewayStt(relay, name),
      ...(options.voice ? { tts: gatewayTts(relay, spoken) } : {}),
      llm: new ClaudeCodeLlm(),
      vad: new inference.VAD(),
      ...sessionOptions,
    });

  /** LiveKit's typing clip, ready to loop. No clip (no ffmpeg) means no sound, never a broken call. */
  const loadClip = async (
    sampleRate: number,
    emit: Emit
  ): Promise<readonly AudioFrame[]> => {
    try {
      const size = (sampleRate * clipFrameMs) / 1000;
      const clip: AudioFrame[] = [];
      const reader = audioFramesFromFile(
        voice.getBuiltinAudioPath(voice.BuiltinAudioClip.KEYBOARD_TYPING),
        { sampleRate, numChannels: 1 }
      ).getReader();
      for (;;) {
        const read = await reader.read();
        if (read.done) break;
        for (const samples of clipFrames(read.value.data, size))
          clip.push(new AudioFrame(samples, sampleRate, 1, size));
      }
      emit('sound.loaded', { frames: clip.length });
      return clip;
    } catch (error) {
      emit('sound.unavailable', { error: String(error) });
      return [];
    }
  };

  const session = async ({
    brain,
    speakers,
    addressing: addressed,
    emit,
    now,
    card,
  }: SessionNeeds): Promise<CallSession> => {
    const made = await makeSession();
    logSession(made, voice.AgentSessionEventTypes, emit);
    const rate = made.tts?.sampleRate;
    let clip: readonly AudioFrame[] = [];
    if (rate !== undefined)
      void loadClip(rate, emit).then((frames) => {
        clip = frames;
      });
    let joined: Room | undefined;
    /** Who the session hears: the person the agent is talking with. */
    const linked = (): readonly [string, string] | undefined => {
      const participant = made._roomIO?.linkedParticipant;
      return participant === undefined
        ? undefined
        : [participant.identity, participant.name || participant.identity];
    };
    const hearing = {
      humans: speakers.humans,
      current: () => linked() ?? speakers.current(),
    };
    const link = (who: string) => {
      made._roomIO?.setParticipant(who);
      emit('call.link', { who });
    };
    const turns: AgentTurns = agentTurns({
      brain,
      speakers: hearing,
      addressing: addressed,
      emit,
      now,
      time,
      card,
      clip: () => clip,
      flush: FlushSentinel,
    });

    /** Someone else said something to the agent: the session turns to them and answers. */
    const turnTo = async (who: string, name: string, text: string) => {
      if (!(await turns.overheard(who, name, text))) return;
      link(who);
      made.clearUserTurn();
      made.generateReply({ userInput: text });
    };
    const ears = new Map<string, Ear | 'opening' | 'failed'>();
    const openEar = async (who: string, name: string) => {
      ears.set(who, 'opening');
      try {
        const listener = await makeSession({ voice: false });
        const input = new FedInput();
        listener.input.audio = input;
        listener.on(voice.AgentSessionEventTypes.Error, ({ error }) =>
          emit('ear.error', {
            who,
            error: error instanceof Error ? error.message : error.error.message,
          })
        );
        await listener.start({
          agent: new EarAgent(
            (text) =>
              void turnTo(who, name, text).catch((error: unknown) =>
                emit('ear.error', { who, error: String(error) })
              )
          ),
        });
        const ear: Ear = {
          push: (frame) => input.push(frame, inRate),
          close: () => listener.close(),
        };
        // Gone while it opened.
        if (ears.get(who) !== 'opening')
          return void ear.close().catch(() => undefined);
        ears.set(who, ear);
        emit('ear.open', { who });
      } catch (error) {
        ears.set(who, 'failed');
        emit('ear.error', { who, error: String(error) });
      }
    };
    const closeEar = (who: string) => {
      const ear = ears.get(who);
      ears.delete(who);
      if (typeof ear === 'object') void ear.close().catch(() => undefined);
    };

    const agent = new VoiceAgent(turns);
    return {
      start: (room) => {
        joined = room;
        return made.start({
          agent,
          room,
          // No text from the room, and the agent leaves on its own timer, not LiveKit's.
          inputOptions: { textEnabled: false, closeOnDisconnect: false },
          outputOptions: rate === undefined ? {} : { audioSampleRate: rate },
        });
      },
      hear: (who, name, frame) => {
        const ear = ears.get(who);
        if (typeof ear === 'object') return ear.push(frame);
        if (ear === undefined && speakers.humans() >= 2)
          void openEar(who, name);
      },
      gone: (who) => {
        closeEar(who);
        if (linked()?.[0] !== who) return;
        // The person it was talking with left: hear someone who's still here.
        const next = [...(joined?.remoteParticipants.values() ?? [])].find(
          (participant) =>
            participant.identity !== who &&
            participant.kind !== ParticipantKind.AGENT
        );
        if (next !== undefined) link(next.identity);
      },
      say: (line, options) => made.say(line, { ...options }).waitForPlayout(),
      interrupt: () => {
        void made.interrupt({ force: true }).await.catch(() => undefined);
      },
      busy: () =>
        made.agentState === 'speaking' || made.agentState === 'thinking',
      close: async () => {
        for (const who of [...ears.keys()]) closeEar(who);
        await made.close();
      },
    };
  };

  return {
    session,
    room: (room, emit, handlers) =>
      observeRoom({ feed: roomFeed(room), emit, handlers, now: time.now }),
    replaySession: async ({ brain, emit, now }) => {
      const made = await makeSession({ voice: false });
      logSession(made, voice.AgentSessionEventTypes, emit);
      const input = new FedInput();
      made.input.audio = input;
      await made.start({
        agent: new VoiceAgent(
          agentTurns({
            brain,
            speakers: replaySpeakers,
            addressing: addressing({ name }),
            emit,
            now,
            time,
            flush: FlushSentinel,
          })
        ),
      });
      return {
        push: (frame, rate) => input.push(frame, rate),
        close: () => made.close(),
      };
    },
    dispose: () => dispose(),
  };
};
