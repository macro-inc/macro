import type { LocalSpeechConstructor } from './core/types';

export function getLocalSpeechRecognition():
  | LocalSpeechConstructor
  | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext) return;
  const Recognition = (
    window as Window & { SpeechRecognition?: LocalSpeechConstructor }
  ).SpeechRecognition;
  // Never fall back to webkitSpeechRecognition or merely assign an unknown
  // property: older implementations may silently send audio to a server.
  if (
    !Recognition ||
    !('processLocally' in Recognition.prototype) ||
    typeof Recognition.available !== 'function' ||
    typeof Recognition.install !== 'function'
  )
    return;
  return Recognition;
}
