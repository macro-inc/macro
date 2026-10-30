import type { Span } from '@macro-inc/observability';
import type { Room } from 'livekit-client';
import {
  captureScreenSource,
  listScreenCaptureSources,
  requestScreenCaptureAccess,
} from './desktop-screen-capture';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { pickScreenSource } from './ScreenSourcePicker';

export type ScreenShareStart = 'shared' | 'cancelled';

/**
 * Starts sharing a screen. The macOS desktop app picks the source in Macro's
 * own picker; everywhere else the browser shows its own. Resolves
 * `cancelled` when the user dismisses Macro's picker.
 */
export async function startScreenShare(
  room: Room,
  span: Span
): Promise<ScreenShareStart> {
  const listed = await listScreenCaptureSources();
  if (listed.isErr()) {
    if (listed.error.kind === 'native') throw listed.error.error;
    span.setAttr('call.media.screen_share.picker', 'browser');
    await room.localParticipant.setScreenShareEnabled(true);
    return 'shared';
  }

  span.setAttr('call.media.screen_share.picker', 'native');
  span.setAttr('call.media.screen_share.has_access', listed.value.hasAccess);
  span.setAttr(
    'call.media.screen_share.source_count',
    listed.value.sources.length
  );
  // The macOS prompt comes up beside the picker; capture still works once the
  // user allows it and reopens the app.
  if (!listed.value.hasAccess) await requestScreenCaptureAccess();

  const source = await pickScreenSource(listed.value);
  if (!source) {
    span.setAttr('call.media.screen_share.cancelled', true);
    return 'cancelled';
  }
  span.setAttr('call.media.screen_share.source_kind', source.kind);

  const track = await captureScreenSource(source.id);
  try {
    await room.localParticipant.publishTrack(track, {
      source: LK_TRACK_SOURCE.ScreenShare,
    });
  } catch (error) {
    track.stop();
    throw error;
  }
  return 'shared';
}
