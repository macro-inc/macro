import { join } from 'node:path';
import { opaqueId, withSpan } from '../telemetry.ts';
import type { Brain } from './brain.ts';
import { Call } from './call.ts';
import { Ear } from './ear.ts';
import { EventLog, TrackRecorder } from './events.ts';
import type { CallApi, Conn } from './macro.ts';
import { retry, TOKEN_RETRY } from './retry.ts';
import { CallRoom, IN_RATE } from './room.ts';
import type { SpeechGateway } from './speech.ts';
import { deepgramStt } from './stt.ts';
import { deepgramTts, TTS_RATE } from './tts.ts';
import type { Invitation } from './watch.ts';

export type CallOptions = {
  invitation: Invitation;
  api: CallApi;
  gateway: SpeechGateway;
  names: string[];
  voice: string;
  directory: string;
  signal: AbortSignal;
  brain(
    emit: EventLog['emit'],
    hangUp: () => void,
    channel: string | null
  ): Brain;
  answer?: (who: string, text: string) => boolean;
  hungUp(callId: string): Promise<void>;
  finished(
    callId: string,
    channel: string | null,
    transcript: string[]
  ): Promise<void>;
};

export async function fetchConn(
  api: Pick<CallApi, 'join'>,
  kind: 'channel' | 'meeting',
  id: string,
  emit: EventLog['emit'],
  options = TOKEN_RETRY
): Promise<Conn> {
  return retry((signal) => api.join(kind, id, signal), {
    ...options,
    onAttempt: (attempt) => emit('join.token', { ...attempt }),
  });
}

/** Each call owns its media resources; hand-offs belong to the longer-lived brain. */
export async function joinCall(options: CallOptions): Promise<void> {
  if (options.signal.aborted) return;
  const dir = join(
    options.directory,
    await opaqueId(options.invitation.callId)
  );
  const log = new EventLog(dir);
  const transcript: string[] = [];
  const emit: EventLog['emit'] = (type, data) => {
    log.emit(type, data);
    if (type === 'turn.ask') transcript.push(`Caller: ${String(data?.text)}`);
    if (type === 'brain.text') transcript.push(`Agent: ${String(data?.text)}`);
  };
  const recorders = new Map<string, TrackRecorder>();
  const ears = new Map<string, Ear>();
  let channel = options.invitation.channel;
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  const brain = options.brain(
    emit,
    () => {
      void options
        .hungUp(options.invitation.callId)
        .then(() => stop.abort('hang_up'))
        .catch((error: unknown) => {
          emit('hang_up.error', { error: String(error) });
          stop.abort('hang_up');
        });
    },
    channel
  );
  const recorder = (who: string, rate: number) => {
    let value = recorders.get(who);
    if (!value) {
      value = new TrackRecorder(
        join(dir, `voice-${recorders.size}.wav`),
        rate,
        log,
        `voice-${recorders.size}`
      );
      recorders.set(who, value);
    }
    return value;
  };
  let call: Call;
  const stt = deepgramStt(options.gateway, emit);
  const room = new CallRoom(emit, {
    joined: (who, name) => call.joined(who, name),
    left: (who) => {
      call.left(who);
      const ear = ears.get(who);
      ears.delete(who);
      void ear?.close();
    },
    audio: (who, frame) => {
      recorder(who, IN_RATE).write(frame);
      let ear = ears.get(who);
      if (!ear) {
        ear = new Ear(
          who,
          stt,
          options.gateway.rescue,
          (event) => call.heard(who, event),
          emit
        );
        ears.set(who, ear);
      }
      ear.push(frame);
    },
    trackEnded: (who) => {
      const ear = ears.get(who);
      ears.delete(who);
      void ear?.close();
    },
    disconnected: () => stop.abort('disconnected'),
  });
  const speaker = room.speaker(TTS_RATE, (pcm) =>
    recorder('agent', TTS_RATE).write(pcm)
  );
  call = new Call(
    brain,
    (handlers) => deepgramTts(options.gateway, emit, handlers, options.voice),
    speaker,
    emit,
    log.now,
    { names: options.names, answer: options.answer }
  );
  call.onLeave = (why) => stop.abort(why);
  try {
    emit('join.start');
    const conn = await withSpan(
      'brain.call.join',
      { 'call.id': options.invitation.callId },
      async () => {
        const conn = await fetchConn(
          options.api,
          options.invitation.kind,
          options.invitation.id,
          emit
        );
        channel = conn.channel;
        await retry(() => room.connect(conn), {
          attempts: 1,
          timeoutMs: 10000,
          backoffMs: [],
        });
        await room.publish('agent-voice');
        return conn;
      }
    );
    emit('call.start', { room: conn.room });
    if (signal.aborted) return;
    call.start();
    const warm = brain.start();
    call.say(`Hey, it's ${options.names[0]}.`);
    await warm;
    if (!signal.aborted)
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      );
  } finally {
    emit('call.leave', { why: String(signal.reason ?? 'error') });
    call.stop();
    await room.leave();
    await Promise.all([...ears.values()].map((ear) => ear.close()));
    await brain.close();
    for (const recorder of recorders.values()) recorder.close();
    log.close();
    if (transcript.length)
      await options.finished(options.invitation.callId, channel, transcript);
  }
}
