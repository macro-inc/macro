import { enableDictation, isFeatureEnabled } from '@core/constant/featureFlags';
import { Telemetry } from '@macro-inc/observability';
import { transcribeAudio } from '@queries/dictation/transcribe';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { AudioRecorder, audioRecorder } from './browser/audio-recorder';
import { createRecordedDictation } from './primitives/create-recorded-dictation';

/** Append plain speech without reparsing or replacing the existing rich draft. */
export function createComposerDictation(editor: () => LexicalEditor) {
  const language = navigator.language || 'en-US';
  return createRecordedDictation({
    // Off means the recorder is never created: no microphone prompt, no audio
    // in memory, and no transcription request.
    supported: isFeatureEnabled(enableDictation) && AudioRecorder.isSupported(),
    startTrace: () => Telemetry.span('dictation.session'),
    createRecorder: (callbacks) => audioRecorder.createSession(callbacks),
    transcribe: (audio, signal, trace) =>
      transcribeAudio(audio, language, signal, trace),
    onConfirm: (text: string) => {
      editor().update(
        () => {
          const root = $getRoot();
          const existing = root.getTextContent();
          root
            .selectEnd()
            .insertText(
              `${existing && !/\s$/.test(existing) ? ' ' : ''}${text}`
            );
        },
        { discrete: true }
      );
      editor().focus();
    },
    onCancel: () => editor().focus(),
  });
}
