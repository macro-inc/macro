/**
 * One call's capabilities: the process that sits in a Macro call as the
 * agent, and a way to check what it hears without a call.
 */
import type { Base } from '../../../context/index.ts';
import { parseWav } from '../audio.ts';
import { joinCapability } from '../config.ts';
import type { Voice } from '../context/voice.ts';
import { joinCall as join, type Outcome } from '../join.ts';
import {
  askedLine,
  heardRecordings,
  isRecording,
  replay,
  resolveCall,
  stubBrain,
} from '../replay.ts';
import type { JoinKind } from '../types.ts';
import { filled } from './filled.ts';

export type VoiceContext = Base & { readonly voice: Voice };

/**
 * Sits in one Macro call as your voice, until the call is over. Run by the
 * calls watcher, one process per call.
 *
 * The calls watcher starts this as a process of its own,
 * `bin/agent joinCall '<json>'`, when the arbiter decides you join a call.
 * Don't call it from a wake or a script: a token request evicts you from any
 * call you're already in, and it only returns when the call is over (the
 * process then exits).
 *
 * `kind` and `id` (not empty): a channel's id, or a meeting's invitation token. `callId`:
 * the live call, so its events start before the room does;
 * `place-<ledger id>` for a call you are placing, which must be pending in
 * the outbound ledger (its token request is what rings them, you open with
 * the reason, and leave after the ring time with a DM if nobody answers).
 * `uninvited`: nobody asked you here, with the reason you chose to go: you
 * say who you are once, answer only to your name, keep no recordings, and
 * the log drops what you overhear. `onOtherCall: "switch"` and `replace` are the
 * arbiter's, after a refusal. `echo` prints every event.
 *
 * The first line it prints is `{"callId","dir"}` (unless `echo` printed
 * events first). Events from t=0 are in the call's directory, with a WAV per
 * voice and the process id. It leaves 30 s after the last human, 60 s if
 * nobody came, on SIGTERM or SIGINT, when asked to hang up, and on SIGUSR2
 * after saying the line in the leave file for its pid.
 *
 * Needs DEEPGRAM_API_KEY: without it the join fails at once.
 *
 * Exit codes: 0 when the call is over (or was already), 1 for a failure worth
 * retrying, and 76-80 for Macro's refusals (in another call, already
 * connected, rate limited, refused, programmatic calls off).
 */
export const joinCall = async (
  { voice }: VoiceContext,
  input: {
    readonly kind: JoinKind;
    readonly id: string;
    readonly callId?: string;
    readonly uninvited?: string;
    readonly onOtherCall?: 'switch';
    readonly replace?: boolean;
    readonly echo?: boolean;
  }
): Promise<Outcome> => {
  filled(input.id, 'id');
  // A join ends by exiting its process, and its token request can evict the
  // agent from a call: inside its main process either would be a disaster.
  if (!voice.ownProcess())
    throw new Error(
      `${joinCapability} runs only as its own process, started by the calls watcher`
    );
  const outcome = await join(voice.join, input);
  voice.exit(outcome.code);
  return outcome;
};

/**
 * Runs a call's recorded audio through the real voice session and says what
 * you would have been asked.
 *
 * For checking what you hear without a call: the recording goes through the
 * real session (VAD, speech-to-text, turn detection, addressing) in real
 * time, with a brain that only answers "Okay." and no voice. `call` (not
 * empty) is a call id, a unique prefix of one, or the path of a 16-bit mono
 * WAV. A call id
 * replays each person's recording, not your own. `events: true` also prints
 * the session's events as they happen. It takes as long as the recording,
 * plus 4 s.
 *
 * Returns, per recording, the lines you would have been asked, in order.
 * Needs DEEPGRAM_API_KEY.
 */
export const replayCall = async (
  { voice, disk, clock, join: path }: VoiceContext,
  { call, events }: { readonly call: string; readonly events?: boolean }
): Promise<
  readonly { readonly recording: string; readonly asked: readonly string[] }[]
> => {
  filled(call, 'call');
  const directory = isRecording(call)
    ? undefined
    : voice.paths.call(resolveCall(call, await disk.list(voice.paths.calls)));
  const recordings =
    directory === undefined
      ? [call]
      : heardRecordings(await disk.list(directory)).map((name) =>
          path(directory, name)
        );
  const livekit = await voice.livekit();
  const replayed: { recording: string; asked: readonly string[] }[] = [];
  for (const recording of recordings) {
    const pcm = parseWav(await voice.readBytes(recording));
    const asks: string[] = [];
    const began = voice.monotonic();
    const log = voice.log({
      elapsed: () => voice.monotonic() - began,
      echo: events === true ? voice.print : undefined,
    });
    const session = await livekit.replaySession({
      brain: stubBrain((content) => asks.push(content)),
      emit: log.emit,
      now: log.now,
    });
    await replay({
      pcm,
      session,
      monotonic: voice.monotonic,
      sleep: clock.sleep,
    });
    replayed.push({ recording, asked: asks.map(askedLine) });
  }
  return replayed;
};
