import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalSpeechRecognition } from './local-speech';

afterEach(() => vi.unstubAllGlobals());

describe('local speech capability detection', () => {
  it('rejects remote-only and prefixed implementations', () => {
    vi.stubGlobal('isSecureContext', true);
    class RemoteRecognition {}
    vi.stubGlobal('SpeechRecognition', RemoteRecognition);
    vi.stubGlobal('webkitSpeechRecognition', RemoteRecognition);
    expect(getLocalSpeechRecognition()).toBeUndefined();
  });

  it('requires local processing support and a secure context', () => {
    class LocalRecognition {
      get processLocally() {
        return false;
      }
      static available() {}
      static install() {}
    }
    vi.stubGlobal('SpeechRecognition', LocalRecognition);
    vi.stubGlobal('isSecureContext', false);
    expect(getLocalSpeechRecognition()).toBeUndefined();
    vi.stubGlobal('isSecureContext', true);
    expect(getLocalSpeechRecognition()).toBe(LocalRecognition);
  });
});
