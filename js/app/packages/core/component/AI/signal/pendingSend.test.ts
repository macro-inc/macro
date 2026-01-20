import { describe, expect, test } from 'vitest';
import {
  getPendingSend,
  setPendingSendData,
  type PendingSend,
} from './pendingSend';

describe('pendingSend signal', () => {
  test('setPendingSendData stores pending send data', () => {
    const data: PendingSend = {
      content: 'Test message',
      attachments: [],
      model: 'claude-haiku-4-5' as any,
    };

    setPendingSendData(data);
    const result = getPendingSend();

    expect(result).toEqual(data);
  });

  test('getPendingSend clears data after retrieval', () => {
    const data: PendingSend = {
      content: 'Test message',
      attachments: [],
      model: 'claude-haiku-4-5' as any,
    };

    setPendingSendData(data);
    getPendingSend();
    const secondCall = getPendingSend();

    expect(secondCall).toBeNull();
  });

  test('getPendingSend returns null when no data is set', () => {
    const result = getPendingSend();
    expect(result).toBeNull();
  });

  test('setPendingSendData with attachments and model', () => {
    const data: PendingSend = {
      content: 'Message with attachment',
      attachments: [
        {
          id: 'attach-1',
          type: 'file',
          name: 'test.pdf',
          size: 1024,
          created_at: '2025-01-01T00:00:00Z',
        } as any,
      ],
      model: 'claude-opus-4-5' as any,
    };

    setPendingSendData(data);
    const result = getPendingSend();

    expect(result?.content).toBe('Message with attachment');
    expect(result?.attachments).toHaveLength(1);
    expect(result?.model).toBe('claude-opus-4-5');
  });
});
