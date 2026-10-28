import { Telemetry } from '@macro-inc/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { whatsappOperation } from './operation';

const span = vi.hoisted(() => ({ setAttr: vi.fn(), error: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: vi.fn(
      async (
        _name: string,
        operation: (value: typeof span) => Promise<unknown>
      ) => operation(span)
    ),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('WhatsApp operation telemetry', () => {
  it('records successful operations without copying their result', async () => {
    const pairing = { qr_code: 'sensitive pairing material' };
    await expect(
      whatsappOperation('connect', async () => pairing)
    ).resolves.toBe(pairing);
    expect(Telemetry.span).toHaveBeenCalledWith(
      'whatsapp.connect',
      expect.any(Function)
    );
    expect(span.setAttr).toHaveBeenCalledExactlyOnceWith(
      'whatsapp.outcome',
      'success'
    );
    expect(span.error).not.toHaveBeenCalled();
  });

  it('records the labels it is given before the operation runs', async () => {
    await whatsappOperation('cancel_pairing', async () => undefined, {
      'whatsapp.cancel_reason': 'escape',
    });
    expect(Telemetry.span).toHaveBeenCalledWith(
      'whatsapp.cancel_pairing',
      expect.any(Function)
    );
    expect(span.setAttr.mock.calls).toEqual([
      ['whatsapp.cancel_reason', 'escape'],
      ['whatsapp.outcome', 'success'],
    ]);
  });

  it('marks errors without recording sensitive server details', async () => {
    const failure = new Error('sensitive passkey assertion');
    await expect(
      whatsappOperation('submit_passkey', async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(span.error).toHaveBeenCalledExactlyOnceWith(
      'WhatsApp operation failed'
    );
    expect(span.setAttr).not.toHaveBeenCalled();
  });
});
