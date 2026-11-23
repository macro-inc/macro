import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DictationController } from '../../../dictation/core/types';
import type { VoiceMemoController } from '../../../dictation/core/voice-memo';
import { MicrophoneAction } from '../MicrophoneAction';

afterEach(cleanup);

function setup() {
  const start = vi.fn(async () => {});
  const memo: VoiceMemoController = {
    phase: () => 'idle',
    active: () => false,
    volumeHistory: () => [],
    elapsedMs: () => 0,
    notice: () => undefined,
    clearNotice: () => {},
    disabled: () => false,
    start,
    stop: async () => {},
    retry: async () => {},
    cancel: () => {},
  };
  const dictation: DictationController = {
    phase: () => 'unavailable',
    active: () => false,
    volumeHistory: () => [],
    elapsedMs: () => 0,
    limitReached: () => false,
    message: () => '',
    messageTone: () => 'info',
    clearMessage: () => {},
    label: () => 'Dictation is unavailable in this browser',
    disabled: () => true,
    start: async () => {},
    confirm: async () => {},
    cancel: () => {},
  };
  render(() => (
    <MicrophoneAction
      dictation={dictation}
      memo={memo}
      showDictation
      showMemo
    />
  ));
  return {
    start,
    button: screen.getByRole('button', { name: 'Record a voice memo' }),
  };
}

describe('memo microphone', () => {
  it('records when pressed', () => {
    const test = setup();
    fireEvent.pointerDown(test.button);
    fireEvent.click(test.button, { detail: 1 });
    expect(test.start).toHaveBeenCalledOnce();
  });

  it('records from the keyboard', () => {
    const test = setup();
    fireEvent.click(test.button, { detail: 0 });
    expect(test.start).toHaveBeenCalledOnce();
  });

  // A phone tap on Send hides it as the draft empties; the tap's click then
  // lands on the microphone that took its place.
  it('ignores a tap that began on another control', () => {
    const test = setup();
    fireEvent.click(test.button, { detail: 1 });
    expect(test.start).not.toHaveBeenCalled();
  });

  it('records for a touch tap, whose pointer leaves before the click', () => {
    const test = setup();
    fireEvent.pointerDown(test.button);
    fireEvent.pointerUp(test.button);
    fireEvent.pointerLeave(test.button);
    fireEvent.click(test.button, { detail: 1 });
    expect(test.start).toHaveBeenCalledOnce();
  });

  it('ignores a click after a cancelled press', () => {
    const test = setup();
    fireEvent.pointerDown(test.button);
    fireEvent.pointerCancel(test.button);
    fireEvent.click(test.button, { detail: 1 });
    expect(test.start).not.toHaveBeenCalled();
  });
});
