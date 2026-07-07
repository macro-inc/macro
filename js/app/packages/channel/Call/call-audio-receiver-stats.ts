import { analytics } from '@app/lib/analytics';
import {
  type AudioReceiverStats,
  type RemoteAudioTrack,
  type Room,
  Track,
} from 'livekit-client';

const SAMPLE_INTERVAL_MS = 30_000;
// Concealment is the perceptual metric for "muddled/underwater" playback:
// the share of decoded samples the decoder synthesized (packet-loss
// concealment, jitter-buffer stretch) instead of received. Above ~5% of an
// interval, degradation is clearly audible.
const BAD_INTERVAL_CONCEALMENT_RATE = 0.05;
// Opus decodes at 48 kHz; totalSamplesDuration is reported in seconds.
const DECODE_SAMPLE_RATE = 48_000;

type Cursor = {
  concealedSamples: number;
  totalSamplesDuration: number;
  packetsLost: number;
  packetsReceived: number;
};

/**
 * Periodically samples remote microphone receiver stats and reports one
 * summary analytics event when stopped (room teardown). Receive-side decode
 * artifacts never show up in capture-side logs, so without this signal a
 * "muddled voices" report can't be split between network concealment and
 * over-eager noise suppression.
 */
export function startReceiverStatsSampling(
  room: Room,
  context: { channelId: string; callId?: string }
): () => void {
  const cursors = new Map<string, Cursor>();
  let sampledIntervals = 0;
  let badIntervals = 0;
  let maxConcealmentRate = 0;
  let maxPacketLossRate = 0;
  let maxJitter = 0;

  async function sampleTrack(identity: string, track: RemoteAudioTrack) {
    let stats: AudioReceiverStats | undefined;
    try {
      stats = await track.getReceiverStats();
    } catch {
      return;
    }
    if (!stats) return;

    const prev = cursors.get(identity);
    const cursor: Cursor = {
      concealedSamples: stats.concealedSamples ?? 0,
      totalSamplesDuration: stats.totalSamplesDuration ?? 0,
      packetsLost: stats.packetsLost ?? 0,
      packetsReceived: stats.packetsReceived ?? 0,
    };
    cursors.set(identity, cursor);
    if (stats.jitter !== undefined) {
      maxJitter = Math.max(maxJitter, stats.jitter);
    }
    if (!prev) return;

    const durationDelta =
      cursor.totalSamplesDuration - prev.totalSamplesDuration;
    const concealedDelta = cursor.concealedSamples - prev.concealedSamples;
    // Counters run backwards when the receiver was replaced mid-call
    // (reconnect / resubscribe); skip that interval.
    if (durationDelta <= 0 || concealedDelta < 0) return;

    sampledIntervals += 1;
    const concealmentRate =
      concealedDelta / (durationDelta * DECODE_SAMPLE_RATE);
    maxConcealmentRate = Math.max(maxConcealmentRate, concealmentRate);
    if (concealmentRate >= BAD_INTERVAL_CONCEALMENT_RATE) badIntervals += 1;

    const packetsDelta = cursor.packetsReceived - prev.packetsReceived;
    const lostDelta = cursor.packetsLost - prev.packetsLost;
    if (lostDelta >= 0 && packetsDelta + lostDelta > 0) {
      maxPacketLossRate = Math.max(
        maxPacketLossRate,
        lostDelta / (packetsDelta + lostDelta)
      );
    }
  }

  function sampleAll() {
    for (const participant of room.remoteParticipants.values()) {
      if (participant.isAgent) continue;
      const track = participant.getTrackPublication(
        Track.Source.Microphone
      )?.track;
      if (!track || track.kind !== Track.Kind.Audio) continue;
      void sampleTrack(participant.identity, track as RemoteAudioTrack);
    }
  }

  const timer = setInterval(sampleAll, SAMPLE_INTERVAL_MS);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    // Nothing sampled means a short or empty call — no event to send.
    if (sampledIntervals === 0) return;
    analytics.track('call_audio_receiver_stats', {
      channelId: context.channelId,
      callId: context.callId,
      sampledIntervals,
      badIntervals,
      maxConcealmentRate,
      maxPacketLossRate,
      maxJitter,
    });
  };
}
