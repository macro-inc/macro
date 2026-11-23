import { formatLocale, t } from '@app/lib/i18n';
import { Telemetry } from '@macro-inc/observability';
import { AudioRecorder, audioRecorder } from './browser/audio-recorder';
import { VOICE_MEMO_FORMATS } from './core/recording';
import { createVoiceMemo } from './primitives/create-voice-memo';

/** A voice memo recorder whose recording `attach` uploads into the draft. */
export function createComposerVoiceMemo(options: {
  attach: (file: File) => Promise<string | undefined>;
  onFinish: () => void;
}) {
  return createVoiceMemo({
    supported: AudioRecorder.isSupported(VOICE_MEMO_FORMATS),
    startTrace: () => Telemetry.span('voice_memo.session'),
    createRecorder: (callbacks) =>
      audioRecorder.createSession(callbacks, VOICE_MEMO_FORMATS),
    now: () => performance.now(),
    fileName: () =>
      t('channelComposer.voiceMemoFileName', {
        time: new Intl.DateTimeFormat(formatLocale(), {
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date()),
      }),
    attach: options.attach,
    onFinish: options.onFinish,
  });
}
