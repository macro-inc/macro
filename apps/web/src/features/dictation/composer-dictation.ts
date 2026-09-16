import { transcribeAudio } from '@queries/dictation/transcribe';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { canRecordAudio, startRecording } from './browser-recording';
import { getLocalSpeechRecognition } from './browser-speech';
import { startMicrophoneVolume } from './browser-volume';
import type { DictationController } from './core/types';
import { createDictation } from './primitives/create-dictation';
import { createRecordedDictation } from './primitives/create-recorded-dictation';

/** Append plain speech without reparsing or replacing the existing rich draft. */
export function createComposerDictation(editor: () => LexicalEditor) {
  const language = navigator.language || 'en-US';
  const callbacks = {
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
  };
  const local = createDictation({
    ...callbacks,
    recognition: getLocalSpeechRecognition(),
    language,
    startVolumeMeter: startMicrophoneVolume,
  });
  const cloud = createRecordedDictation({
    ...callbacks,
    supported: canRecordAudio(),
    startRecording,
    transcribe: (audio, signal) => transcribeAudio(audio, language, signal),
  });
  const current = () =>
    cloud.active() || local.phase() === 'unavailable' ? cloud : local;
  const controller: DictationController = {
    phase: () => current().phase(),
    active: () => current().active(),
    volumeHistory: () => current().volumeHistory(),
    transcript: () => current().transcript(),
    message: () => current().message(),
    label: () => current().label(),
    disabled: () => current().disabled(),
    start: () => current().start(),
    confirm: () => current().confirm(),
    cancel: () => current().cancel(),
  };
  return controller;
}
