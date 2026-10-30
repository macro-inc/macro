import { t } from '@app/lib/i18n';
import type { Span } from '@macro-inc/observability';
import type { Room } from 'livekit-client';
import { callMediaErrorType } from './call-media-telemetry';
import {
  captureScreenSource,
  listScreenCaptureSources,
  requestScreenCaptureAccess,
} from './desktop-screen-capture';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { pickScreenSource } from './ScreenSourcePicker';
import { ScreenShareError } from './screen-share-error';

export type ScreenShareStart = 'shared' | 'cancelled';

/** Keeps the cause's type on the span, which records only the wrapper. */
function shareFailed(span: Span, message: string, cause: unknown) {
  span.setAttr('call.media.screen_share.error_type', callMediaErrorType(cause));
  return new ScreenShareError(message, { cause });
}

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
    if (listed.error.kind === 'native') {
      throw shareFailed(span, t('calls.shareFailed'), listed.error.error);
    }
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

  let track: MediaStreamTrack;
  try {
    track = await captureScreenSource(source.id);
  } catch (error) {
    // macOS refuses capture until Screen Recording is allowed.
    const message =
      callMediaErrorType(error) === 'NotAllowedError'
        ? t('calls.screenAccessNeeded')
        : t('calls.shareFailed');
    throw shareFailed(span, message, error);
  }
  try {
    await room.localParticipant.publishTrack(track, {
      source: LK_TRACK_SOURCE.ScreenShare,
    });
  } catch (error) {
    track.stop();
    throw shareFailed(span, t('calls.shareFailed'), error);
  }
  return 'shared';
}
