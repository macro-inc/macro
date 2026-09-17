import { transcribeAudio } from '@queries/dictation/transcribe';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { AudioRecorder } from './browser/audio-recorder';
import { getLocalSpeechRecognition } from './browser/local-speech';
import type { CreateRecorder } from './core/recording';
import type { DictationController } from './core/types';
import { createLocalDictation } from './primitives/create-local-dictation';
import { createRecordedDictation } from './primitives/create-recorded-dictation';

const createRecorder: CreateRecorder = (callbacks) =>
  new AudioRecorder(callbacks);

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
  const local = createLocalDictation({
    ...callbacks,
    recognition: getLocalSpeechRecognition(),
    language,
    createRecorder,
  });
  const cloud = createRecordedDictation({
    ...callbacks,
    supported: AudioRecorder.isSupported(),
    createRecorder,
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
