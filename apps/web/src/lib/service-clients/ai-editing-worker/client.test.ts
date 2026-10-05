import { toastAiEditResult } from '@app/features/block-md/queries/ai-edit';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { hasActiveAiEdit, requestAiEdit } from './client';

const { failure, permissionToken, span } = vi.hoisted(() => ({
  failure: vi.fn(),
  permissionToken: vi.fn(),
  span: {
    setAttr: vi.fn(),
    injectTraceHeaders: vi.fn(),
    error: vi.fn(),
    end: vi.fn(),
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure } }));
vi.mock('@block-md/observability', () => ({
  resumeDocumentSpan: () => undefined,
}));
vi.mock('@service-storage/client', () => ({
  getDocumentPermissionToken: permissionToken,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { clientSpan: () => span },
}));

const state = useAiUsageLimitState();
const fetch = vi.fn<typeof window.fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  state.hideUsageLimit();
  permissionToken.mockResolvedValue('test-document-permission');
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  state.hideUsageLimit();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([
  'ai_allowance_exhausted',
  'ai_overage_limit_reached',
  'ai_overage_payment_failed',
])(
  'opens the usage dialog for a rejected edit (%s) without applying ops or showing a generic toast',
  async (code) => {
    fetch.mockResolvedValueOnce(
      Response.json({ code, error: 'Usage blocked' }, { status: 402 })
    );
    const onOps = vi.fn();

    const result = await requestAiEdit({
      documentId: 'document',
      prompt: 'Improve this',
      onOps,
    });
    expect(state.usageLimitOpen()).toBe(false);
    toastAiEditResult(result);

    expect(result).toEqual({
      kind: 'usage-limit',
      error: { code: 'AI_USAGE_LIMIT', reason: code, message: 'Usage blocked' },
    });
    expect(state.usageLimitOpen()).toBe(true);
    expect(state.usageLimitCode()).toBe(code);
    expect(failure).not.toHaveBeenCalled();
    expect(onOps).not.toHaveBeenCalled();
    expect(hasActiveAiEdit('document')).toBe(false);
    expect(span.end).toHaveBeenCalledOnce();
  }
);

test.each([403, 500, 503])(
  'keeps non-quota HTTP %i edit failures as generic errors',
  async (status) => {
    fetch.mockResolvedValueOnce(
      Response.json({ code: 'ai_billing_unavailable' }, { status })
    );

    const result = await requestAiEdit({
      documentId: 'document',
      prompt: 'Improve this',
    });
    toastAiEditResult(result);

    expect(result).toEqual({ kind: 'failed' });
    expect(state.usageLimitOpen()).toBe(false);
    expect(failure).toHaveBeenCalledWith('AI edit failed');
    expect(hasActiveAiEdit('document')).toBe(false);
  }
);

test('keeps successful edits and clarification requests distinct from quota failures', async () => {
  const onOps = vi.fn();
  fetch.mockResolvedValueOnce(Response.json({ ops: [] }));
  expect(
    await requestAiEdit({
      documentId: 'document',
      prompt: 'Improve this',
      onOps,
    })
  ).toEqual({ kind: 'ok' });
  expect(onOps).toHaveBeenCalledWith([]);

  fetch.mockResolvedValueOnce(
    Response.json({ ops: [], clarification: 'Which paragraph?' })
  );
  const result = await requestAiEdit({
    documentId: 'document',
    prompt: 'Improve this',
  });
  toastAiEditResult(result);

  expect(failure).toHaveBeenCalledWith('Which paragraph?');
  expect(state.usageLimitOpen()).toBe(false);
});
