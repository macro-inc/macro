import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DictationController, DictationPhase } from '../core/types';
import type { VoiceMemoController, VoiceMemoPhase } from '../core/voice-memo';
import { DictationPanel } from './dictation-controls';
import { VoiceMemoPanel } from './voice-memo-controls';

// jsdom has no layout; the timeline only needs the observer to exist.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function memoController() {
  const [phase, setPhase] = createSignal<VoiceMemoPhase>('recording');
  const memo: VoiceMemoController = {
    phase,
    active: () => phase() !== 'idle',
    volumeHistory: () => [0.4, 0.6],
    elapsedMs: () => 3_000,
    notice: () => undefined,
    clearNotice: () => {},
    disabled: () => phase() !== 'idle',
    start: async () => {},
    stop: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    cancel: vi.fn(),
  };
  return { memo, setPhase };
}

function dictationController() {
  const [phase, setPhase] = createSignal<DictationPhase>('listening');
  const [message, setMessage] = createSignal('');
  const dictation: DictationController = {
    phase,
    active: () => phase() !== 'idle',
    volumeHistory: () => [0.3],
    elapsedMs: () => 2_000,
    limitReached: () => false,
    message,
    messageTone: () => (message() ? 'error' : 'info'),
    clearMessage: () => setMessage(''),
    label: () => 'Start dictation',
    disabled: () => phase() !== 'idle',
    start: async () => {},
    confirm: vi.fn(async () => {}),
    cancel: vi.fn(),
  };
  return { dictation, setPhase, setMessage };
}

describe('voice memo panel', () => {
  it('takes focus on its row, not a button, and lays out like the composer', async () => {
    const { memo } = memoController();
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    const row = screen.getByRole('group', { name: 'Recording voice memo' });
    expect(document.activeElement).toBe(row);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Discard voice memo',
      'Stop and attach',
    ]);
    // The timer is shown but not a live region, which would read it out
    // every second.
    expect(screen.getByText('0:03').closest('[aria-live]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('leaves focus the person moved elsewhere when its phase changes', async () => {
    const { memo, setPhase } = memoController();
    render(() => (
      <>
        <input aria-label="Elsewhere" />
        <VoiceMemoPanel memo={memo} />
      </>
    ));
    await settle();
    const elsewhere = screen.getByRole('textbox', { name: 'Elsewhere' });
    elsewhere.focus();
    setPhase('failed');
    await settle();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('ignores Enter while it uploads', async () => {
    const { memo, setPhase } = memoController();
    setPhase('attaching');
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    fireEvent.keyDown(
      screen.getByRole('group', { name: 'Recording voice memo' }),
      { key: 'Enter' }
    );
    expect(memo.stop).not.toHaveBeenCalled();
    expect(memo.retry).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Attaching…');
  });

  it('stops on Enter or Space and discards on Escape from the row', async () => {
    const { memo } = memoController();
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    const row = screen.getByRole('group', { name: 'Recording voice memo' });
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(memo.stop).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(memo.cancel).toHaveBeenCalledOnce();
  });

  it('keeps focus in the panel when Stop turns into Retry', async () => {
    const { memo, setPhase } = memoController();
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    screen.getByRole('button', { name: 'Stop and attach' }).focus();
    setPhase('failed');
    await settle();
    const row = screen.getByRole('group', { name: 'Recording voice memo' });
    expect(row.contains(document.activeElement)).toBe(true);
    // Shown in the row and announced by the live region.
    expect(
      screen.getAllByText('Could not attach the voice memo.')
    ).toHaveLength(2);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(memo.retry).toHaveBeenCalledOnce();
  });

  it('cannot be discarded while it uploads', async () => {
    const { memo, setPhase } = memoController();
    setPhase('attaching');
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    const discard = screen.getByRole('button', { name: 'Discard voice memo' });
    expect(discard.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(discard);
    fireEvent.keyDown(
      screen.getByRole('group', { name: 'Recording voice memo' }),
      { key: 'Escape' }
    );
    expect(memo.cancel).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Stop and attach' })
        .getAttribute('aria-busy')
    ).toBe('true');
  });
});

describe('dictation panel', () => {
  it('shows the mode, the time, and Cancel and Use where + and Send were', async () => {
    const { dictation } = dictationController();
    render(() => <DictationPanel dictation={dictation} />);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: 'Dictation' })
    );
    expect(
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Cancel dictation', 'Use dictation']);
    expect(screen.getByText('0:02').closest('[aria-live]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('keeps Escape working after Use, while it transcribes', async () => {
    const { dictation, setPhase } = dictationController();
    render(() => <DictationPanel dictation={dictation} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Use dictation' }));
    expect(dictation.confirm).toHaveBeenCalledOnce();
    setPhase('finishing');
    await settle();
    expect(screen.getByRole('status').textContent).toBe('Transcribing…');
    const row = screen.getByRole('group', { name: 'Dictation' });
    expect(row.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? row, { key: 'Escape' });
    expect(dictation.cancel).toHaveBeenCalledOnce();
  });

  it('states a failed transcription in the panel and retries it', async () => {
    const { dictation, setPhase, setMessage } = dictationController();
    render(() => <DictationPanel dictation={dictation} />);
    await settle();
    setMessage('Network error occurred');
    setPhase('review');
    await settle();
    expect(screen.getAllByText('Network error occurred')).toHaveLength(2);
    expect(screen.queryByText('Ready')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Try transcribing again' })
    );
    expect(dictation.confirm).toHaveBeenCalledOnce();
  });
});

describe('announcements', () => {
  it('keeps one polite live region mounted from the start', async () => {
    const { memo } = memoController();
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
  });

  it('announces a failed memo upload', async () => {
    const { memo, setPhase } = memoController();
    render(() => <VoiceMemoPanel memo={memo} />);
    await settle();
    const status = screen.getByRole('status');
    setPhase('failed');
    await settle();
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Could not attach the voice memo.');
  });

  it('announces a failed transcription', async () => {
    const { dictation, setPhase, setMessage } = dictationController();
    render(() => <DictationPanel dictation={dictation} />);
    await settle();
    const status = screen.getByRole('status');
    setMessage('Transcription failed.');
    setPhase('review');
    await settle();
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Transcription failed.');
  });
});
