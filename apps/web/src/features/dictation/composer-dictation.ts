import { transcribeAudio } from '@queries/dictation/transcribe';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { AudioRecorder, audioRecorder } from './browser/audio-recorder';
import { startDictationTrace } from './browser/dictation-trace';
import { createRecordedDictation } from './primitives/create-recorded-dictation';

/** Append plain speech without reparsing or replacing the existing rich draft. */
export function createComposerDictation(editor: () => LexicalEditor) {
  const language = navigator.language || 'en-US';
  return createRecordedDictation({
    supported: AudioRecorder.isSupported(),
    startTrace: startDictationTrace,
    createRecorder: (callbacks) => audioRecorder.createSession(callbacks),
    transcribe: (audio, signal) => transcribeAudio(audio, language, signal),
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
