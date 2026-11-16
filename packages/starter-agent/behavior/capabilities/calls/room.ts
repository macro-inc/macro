/**
 * The room as the recorder sees it: every human's audio as 20 ms 16 kHz
 * frames, and every track and speaker event logged, so "can't hear me" says
 * which layer failed. The agent's own hearing and voice belong to the
 * AgentSession; this is off its audio path.
 *
 * It reads the room through a `RoomFeed`, which `context/` builds over a
 * LiveKit Room, so all of this runs against a fake.
 */
import type { Emit } from './types.ts';

export const inRate = 16000;
/** Samples in one 20 ms frame. */
export const inFrame = 320;
export const frameMs = 20;
/** Who the agent's own published audio counts as, in the recordings. */
export const agentVoice = 'agent';

export type RoomHandlers = {
  readonly joined: (who: string, name: string) => void;
  readonly left: (who: string) => void;
  /** One 20 ms frame from a participant's microphone. */
  readonly audio: (who: string, frame: Int16Array) => void;
  /** A participant's audio track went away (unsubscribed, unpublished). */
  readonly trackEnded?: (who: string) => void;
  /** Who our own published audio counts as, to have it delivered to `audio` too. */
  readonly ownVoice?: string;
  readonly disconnected: (reason: string) => void;
};

/** Someone in the room. An agent (LiveKit's participant kind) isn't a human. */
export type Member = {
  readonly identity: string;
  readonly name: string;
  readonly kind: number;
  readonly human: boolean;
};

/** A track publication, as the room reports it. `Track` is the room's own handle for reading it. */
export type Publication<Track> = {
  readonly sid: string;
  readonly audio: boolean;
  readonly kind?: number;
  readonly source?: number;
  readonly muted: boolean;
  /** Present once subscribed. */
  readonly track?: Track;
};

export type AudioChunk = {
  readonly data: Int16Array;
  readonly sampleRate: number;
  readonly samplesPerChannel: number;
};

export type RoomListener<Track> = {
  readonly joined: (member: Member) => void;
  readonly left: (member: Member) => void;
  /** One of our own tracks was published. */
  readonly ownTrack: (publication: Publication<Track>) => void;
  readonly published: (publication: Publication<Track>, member: Member) => void;
  readonly subscribed: (
    publication: Publication<Track>,
    member: Member
  ) => void;
  readonly unsubscribed: (sid: string, member: Member) => void;
  readonly subscriptionFailed: (
    sid: string,
    member: Member,
    reason?: string
  ) => void;
  readonly muted: (sid: string, who: string, muted: boolean) => void;
  /** Who the room says is speaking now, by identity. */
  readonly speakers: (who: readonly string[]) => void;
  readonly reconnecting: () => void;
  readonly reconnected: () => void;
  readonly disconnected: (reason: string) => void;
};

/** A connected room, reduced to what watching it needs. */
export type RoomFeed<Track> = {
  /** Who we are in the room. */
  readonly identity: () => string | undefined;
  /** Everyone else in the room now, with their publications. */
  readonly members: () => readonly (Member & {
    readonly publications: readonly Publication<Track>[];
  })[];
  readonly listen: (listener: RoomListener<Track>) => void;
  /** A track's audio as mono frames at `inRate`, about `frameMs` long, until the track ends. */
  readonly frames: (track: Track) => AsyncIterable<AudioChunk>;
  readonly disconnect: () => Promise<void>;
};

export type CallRoom = {
  /** Reports who was already in the room, and starts listening to them. Call once, after connecting. */
  readonly present: (room: string) => void;
  /** The identities of the humans in the room. */
  readonly humans: () => readonly string[];
  /** The human who spoke most recently, as [identity, display name]. */
  readonly lastSpeaker: () => readonly [string, string];
  readonly leave: () => Promise<void>;
};

/** Who the speaker is when the room has no human. */
export const nobody = ['unknown', 'Someone'] as const;

export const observeRoom = <Track>({
  feed,
  emit,
  handlers,
  now,
}: {
  readonly feed: RoomFeed<Track>;
  readonly emit: Emit;
  readonly handlers: RoomHandlers;
  /** Monotonic milliseconds, to order who spoke last. */
  readonly now: () => number;
}): CallRoom => {
  /** The sids of the tracks being read. */
  const listening = new Set<string>();
  /** When each identity was last an active speaker. */
  const lastActive = new Map<string, number>();
  const humans = () => feed.members().filter(({ human }) => human);

  const read = async (track: Track, sid: string, who: string) => {
    let frames = 0;
    try {
      for await (const chunk of feed.frames(track)) {
        if (frames++ === 0)
          emit('room.first_frame', {
            who,
            sid,
            rate: chunk.sampleRate,
            samples: chunk.samplesPerChannel,
          });
        // Frames should be 320 samples; re-chunk defensively if not.
        for (let i = 0; i + inFrame <= chunk.data.length; i += inFrame)
          handlers.audio(who, chunk.data.slice(i, i + inFrame));
      }
    } catch (error) {
      emit('room.stream_error', { who, sid, error: String(error) });
    } finally {
      listening.delete(sid);
      emit('room.stream_ended', { who, sid, frames });
      handlers.trackEnded?.(who);
    }
  };

  const subscribed = (
    { sid, audio, kind, source, muted, track }: Publication<Track>,
    member: Member
  ) => {
    emit('room.track_subscribed', {
      who: member.identity,
      kind,
      sid,
      source,
      muted,
    });
    if (!audio || !member.human || track === undefined || listening.has(sid))
      return;
    listening.add(sid);
    void read(track, sid, member.identity);
  };

  feed.listen({
    joined: (member) => {
      emit('room.participant_joined', {
        who: member.identity,
        name: member.name,
        kind: member.kind,
      });
      if (member.human)
        handlers.joined(member.identity, member.name || member.identity);
    },
    left: (member) => {
      emit('room.participant_left', { who: member.identity });
      if (member.human) handlers.left(member.identity);
    },
    // The agent's voice, for the recording: its own stream, off the session's path.
    ownTrack: ({ sid, track }) => {
      if (handlers.ownVoice !== undefined && track !== undefined)
        void read(track, sid, handlers.ownVoice);
    },
    published: ({ sid, kind, source, muted }, member) =>
      emit('room.track_published', {
        who: member.identity,
        kind,
        source,
        sid,
        muted,
      }),
    subscribed,
    unsubscribed: (sid, member) =>
      emit('room.track_unsubscribed', { who: member.identity, sid }),
    subscriptionFailed: (sid, member, reason) =>
      emit('room.track_subscription_failed', {
        who: member.identity,
        sid,
        reason,
      }),
    muted: (sid, who, muted) =>
      emit(muted ? 'room.track_muted' : 'room.track_unmuted', { who, sid }),
    speakers: (who) => {
      for (const identity of who) lastActive.set(identity, now());
      emit('room.active_speakers', { who });
    },
    reconnecting: () => emit('room.reconnecting'),
    reconnected: () => emit('room.reconnected'),
    disconnected: (reason) => {
      emit('room.disconnected', { reason });
      handlers.disconnected(reason);
    },
  });

  return {
    present: (room) => {
      emit('room.joined', { room, as: feed.identity() });
      for (const member of feed.members()) {
        emit('room.participant_present', {
          who: member.identity,
          name: member.name,
          kind: member.kind,
        });
        if (!member.human) continue;
        handlers.joined(member.identity, member.name || member.identity);
        for (const publication of member.publications)
          if (publication.audio && publication.track !== undefined)
            subscribed(publication, member);
      }
    },
    humans: () => humans().map(({ identity }) => identity),
    lastSpeaker: () => {
      const [latest] = humans().sort(
        (a, b) =>
          (lastActive.get(b.identity) ?? 0) - (lastActive.get(a.identity) ?? 0)
      );
      return latest === undefined
        ? nobody
        : [latest.identity, latest.name || latest.identity];
    },
    leave: () => feed.disconnect().catch(() => undefined),
  };
};
