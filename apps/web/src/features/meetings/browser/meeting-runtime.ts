import { loadLivekit } from '@channel/Call/livekit-loader';

/** Warm only code; no room, microphone, or meeting is created here. */
export async function preloadMeetingRuntime(): Promise<void> {
  await Promise.all([
    loadLivekit(),
    import('@channel/Call/LivekitJsCallController'),
  ]);
}
