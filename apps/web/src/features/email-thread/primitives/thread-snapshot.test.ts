import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import type { EmailThread } from '../core/email-thread';
import { message, thread } from '../tests/fixtures';
import { createThreadSnapshot } from './thread-snapshot';

it('retains readable data during failure, clears on identity change, and respects a successful empty result', () =>
  createRoot((dispose) => {
    try {
      const [id, setId] = createSignal('thread');
      const [error, setError] = createSignal(false);
      const [data, setData] = createSignal<EmailThread | undefined>(
        thread([message('one')])
      );
      const snapshot = createThreadSnapshot({
        id,
        thread: data,
        isError: error,
        isLoading: () => false,
      });
      const original = snapshot();
      batch(() => {
        setError(true);
        setData(undefined);
      });
      expect(snapshot()).toBe(original);
      setId('different');
      expect(snapshot()).toBeUndefined();
      batch(() => {
        setId('thread');
        setError(false);
        setData(original);
      });
      expect(snapshot()).toBe(original);
      setData(undefined);
      expect(snapshot()).toBeUndefined();
    } finally {
      dispose();
    }
  }));
