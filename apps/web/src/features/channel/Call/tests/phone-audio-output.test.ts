import { describe, expect, it } from 'vitest';
import {
  isMissingAudioOutputCommand,
  matchingAudioOutputState,
} from '../PhoneAudioOutput';

describe('phone audio output', () => {
  it('ignores route updates from a previous native call', () => {
    const previous = {
      callId: 'old-call',
      selectedId: 'speaker',
      outputs: [{ id: 'speaker', label: 'Speaker' }],
    };
    expect(matchingAudioOutputState('new-call', previous)).toBeNull();
    expect(matchingAudioOutputState(null, previous)).toBeNull();
    expect(matchingAudioOutputState('OLD-CALL', previous)).toEqual(previous);
  });

  it('hides output control for older native binaries', () => {
    expect(
      isMissingAudioOutputCommand('Command get_audio_output not found')
    ).toBe(true);
    expect(
      isMissingAudioOutputCommand('Command watch_audio_output not found')
    ).toBe(true);
    expect(
      isMissingAudioOutputCommand('Command select_audio_output not found')
    ).toBe(true);
    expect(
      isMissingAudioOutputCommand('Audio output is unavailable for this call')
    ).toBe(false);
  });
});
