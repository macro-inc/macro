import { afterEach, describe, expect, it, vi } from 'vitest';

// Source control for the native AI-edit host: the order in which the real OFF
// client runs onOps, its registry cleanup, the toast and onSettled.

const log: string[] = [];

vi.mock('@service-storage/client', () => ({
  getDocumentPermissionToken: vi.fn(async () => 'token'),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    failure: (message: string) => log.push(`toast.failure:${message}`),
    success: (message: string) => log.push(`toast.success:${message}`),
  },
}));
vi.mock('@app/features/paywall/ai-usage-limit-handling', () => ({
  handleAiUsageLimitError: () => log.push('usage-limit'),
}));

const { hasActiveAiEdit, requestAiEditWithToast } = await import('./ai-edit');

const DOC = 'doc-source-controls';

function respond(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      log.push('fetch');
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
}

async function run(onOps: () => void): Promise<string[]> {
  log.length = 0;
  await requestAiEditWithToast(
    { documentId: DOC, prompt: 'p', mode: 'fast', onOps },
    () => log.push(`onSettled active=${hasActiveAiEdit(DOC)}`)
  );
  return [...log];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Source AI edit client settlement order', () => {
  it('runs onOps synchronously before cleanup, toast and onSettled', async () => {
    respond({ ops: [{ kind: 'setText', node: 'n', text: 't' }] });
    const order = await run(() => {
      log.push(`onOps active=${hasActiveAiEdit(DOC)}`);
    });
    expect(order).toEqual([
      'fetch',
      'onOps active=true',
      'onSettled active=false',
    ]);
  });

  it('turns a throwing onOps into the failed toast', async () => {
    // Not the op-refusal path: in the app editor applyAiOps does not throw for a
    // refused op (onError is Telemetry.error), so this is any other onOps throw.
    respond({ ops: [{ kind: 'setText', node: 'n', text: 't' }] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order = await run(() => {
      log.push(`onOps active=${hasActiveAiEdit(DOC)}`);
      throw new Error('refused');
    });
    errors.mockRestore();
    expect(order).toEqual([
      'fetch',
      'onOps active=true',
      'toast.failure:AI edit failed',
      'onSettled active=false',
    ]);
  });

  it('reports ok for a returned Promise without awaiting it', async () => {
    respond({ ops: [] });
    let resolved = false;
    const order = await run(() => {
      log.push('onOps');
      return Promise.resolve().then(() => {
        resolved = true;
        log.push('promise settled');
      }) as never;
    });
    // The client neither awaits nor inspects the return value.
    expect(order.slice(0, 2)).toEqual(['fetch', 'onOps']);
    expect(order).not.toContain('toast.failure:AI edit failed');
    expect(resolved).toBe(true);
  });
});
