import { Telemetry } from '@macro-inc/observability';
import { AudioRecorder, audioRecorder } from './browser/audio-recorder';
import { VOICE_MEMO_FORMATS } from './core/recording';
import { createVoiceMemo } from './primitives/create-voice-memo';

/** A voice memo recorder whose recording `attach` uploads into the draft. */
export function createComposerVoiceMemo(
  attach: (file: File) => Promise<boolean>
) {
  return createVoiceMemo({
    supported: AudioRecorder.isSupported(VOICE_MEMO_FORMATS),
    startTrace: () => Telemetry.span('voice_memo.session'),
    createRecorder: (callbacks) =>
      audioRecorder.createSession(callbacks, VOICE_MEMO_FORMATS),
    now: () => performance.now(),
    recordedAt: () => new Date(),
    attach,
  });
}
