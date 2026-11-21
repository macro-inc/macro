import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPolicySource,
  EmailPolicyView,
  EmailRuleValidation,
} from '../context/email-policy';
import { createEmailPolicySettings } from './email-policy-settings';

const RULES = {
  schema_version: 1,
  include: [{ kind: 'domain' as const, domain: 'example.com' }],
};
const INITIAL: EmailPolicyView = {
  authoring_available: true,
  enabled: true,
  mode: 'selected',
  effect: '',
  rules: RULES,
  revision: 1,
  token: { kind: 'legacy', fingerprint: 'first' },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function mount(gate = true) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [view, setView] = createSignal(INITIAL);
    const [enabled, setEnabled] = createSignal(gate);
    const [scope, setScope] = createSignal('account-session-team');
    const validate = vi.fn<EmailPolicySource['validate']>().mockResolvedValue(
      ok({
        rules: RULES,
        effect: '',
        inactive_rule_indices: [],
        broad_rule_indices: [],
      })
    );
    const change = vi.fn<EmailPolicySource['change']>().mockResolvedValue(
      ok({
        audit_event_id: 'event',
        effect: '',
        enabled: true,
        mode: 'selected',
        replayed: false,
        revision: 2,
        token: { kind: 'legacy', fingerprint: 'second' },
      })
    );
    const source: EmailPolicySource = {
      scope,
      createRuleName: () => () => undefined,
      createPreview: () => ({
        data: undefined,
        isPending: true,
        isSuccess: false,
        isError: false,
        isLoading: false,
        refetch: async () => undefined,
      }),
      query: {
        get data() {
          return view();
        },
        isPending: false,
        isSuccess: true,
        isError: false,
        isLoading: false,
        refetch: async () => undefined,
      },
      read: vi
        .fn<EmailPolicySource['read']>()
        .mockImplementation(async () => ok(view())),
      validate,
      change,
      preview: vi
        .fn<EmailPolicySource['preview']>()
        .mockResolvedValue(ok(null)),
      startPreview: vi.fn<EmailPolicySource['startPreview']>(),
      cancelPreview: vi
        .fn<EmailPolicySource['cancelPreview']>()
        .mockResolvedValue(ok(undefined)),
      history: vi
        .fn<EmailPolicySource['history']>()
        .mockResolvedValue(ok({ events: [] })),
      revision: vi
        .fn<EmailPolicySource['revision']>()
        .mockResolvedValue(ok(null)),
    };
    return {
      settings: createEmailPolicySettings(source, enabled),
      source,
      validate,
      change,
      setEnabled,
      setView,
      setScope,
      dispose,
    };
  });
}

describe('email sharing decisions', () => {
  it('does not mutate when settings or the editor open', () => {
    const { settings, validate, change } = mount();
    settings.beginEdit();
    expect(settings.state.draft).toBe(JSON.stringify(RULES, null, 2));
    expect(validate).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it('validates before saving and submits only the canonical rules', async () => {
    const { settings, validate, change } = mount();
    const order: string[] = [];
    const canonical: EmailRuleValidation = {
      rules: RULES,
      effect: '',
      broad_rule_indices: [0],
      inactive_rule_indices: [],
    };
    validate.mockImplementation(async () => {
      order.push('validate');
      return ok(canonical);
    });
    change.mockImplementation(async (command) => {
      order.push('save');
      expect(command.change).toEqual({ action: 'replace_rules', rules: RULES });
      return ok({
        audit_event_id: 'event',
        effect: '',
        enabled: true,
        mode: 'selected',
        replayed: false,
        token: INITIAL.token!,
      });
    });
    settings.beginEdit();
    settings.edit(
      '{"schema_version":1,"include":[{"kind":"domain","domain":"EXAMPLE.COM"}]}'
    );
    expect(await settings.save()).toBe(true);
    expect(order).toEqual(['validate', 'save']);
    expect(settings.state.validation?.broad_rule_indices).toEqual([0]);
    expect(settings.state.canonicalized).toBe(true);
    expect(settings.state.draft).toBe(JSON.stringify(RULES, null, 2));
    expect(settings.canSave()).toBe(false);
  });

  it('keeps invalid JSON and never sends it as a policy change', async () => {
    const { settings, validate, change } = mount();
    settings.beginEdit();
    settings.edit('{');
    expect(await settings.save()).toBe(false);
    expect(settings.state.draft).toBe('{');
    expect(settings.state.error).toBeTruthy();
    expect(validate).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it('shows the exact limit refusal and preserves the draft', async () => {
    const { settings, validate, change } = mount();
    validate.mockResolvedValue(
      err([
        {
          code: 'HTTP_ERROR',
          message: 'Contact discovery limit exceeded: 2000 addresses.',
        },
      ])
    );
    settings.beginEdit();
    const draft = settings.state.draft;
    expect(await settings.save()).toBe(false);
    expect(settings.state.error).toBe(
      'Contact discovery limit exceeded: 2000 addresses.'
    );
    expect(settings.state.draft).toBe(draft);
    expect(change).not.toHaveBeenCalled();
  });

  it('locks a stale decision and requires explicit comparison before another save', async () => {
    const { settings, source, change, setView } = mount();
    change.mockResolvedValue(
      err([{ code: 'CONFLICT', message: 'Consent changed' }])
    );
    settings.beginEdit();
    const draft = settings.state.draft;
    await settings.save();
    expect(settings.state.error).toBeUndefined();
    expect(settings.stale()).toBe(true);
    expect(settings.canSave()).toBe(false);
    expect(settings.state.draft).toBe(draft);
    expect(source.read).not.toHaveBeenCalled();
    await settings.save();
    expect(change).toHaveBeenCalledTimes(1);
    setView({ ...INITIAL, token: { kind: 'legacy', fingerprint: 'current' } });
    await settings.inspectCurrent();
    expect(settings.canSave()).toBe(false);
    settings.useReviewedDecision();
    expect(settings.canSave()).toBe(true);
    expect(settings.state.draft).toBe(draft);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a decision from an automatic background read', () => {
    const { settings, setView } = mount();
    settings.beginEdit();
    setView({ ...INITIAL, token: { kind: 'legacy', fingerprint: 'changed' } });
    expect(settings.stale()).toBe(true);
    expect(settings.state.token).toEqual(INITIAL.token);
  });

  it('gates all authoring and preview starts but leaves owner inspection available', async () => {
    const { settings, source, validate, change, setEnabled } = mount(false);
    settings.beginEdit();
    await settings.save();
    await settings.inspectPreview();
    await settings.startPreview();
    expect(validate).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(source.startPreview).not.toHaveBeenCalled();
    await settings.loadHistory();
    expect(source.history).toHaveBeenCalledOnce();
    setEnabled(true);
    expect(settings.canSave()).toBe(true);
    await settings.save();
    expect(change).toHaveBeenCalledOnce();
  });

  it('honors the server gate even when the frontend flag is on', async () => {
    const { settings, setView, change } = mount();
    setView({ ...INITIAL, authoring_available: false });
    settings.beginEdit();
    await settings.save();
    expect(change).not.toHaveBeenCalled();
  });

  it('does not activate when the gate or owner changes during validation', async () => {
    for (const transition of ['gate', 'account', 'disposed'] as const) {
      const { settings, validate, change, setEnabled, setScope, dispose } =
        mount();
      validate.mockImplementation(async () => {
        if (transition === 'gate') setEnabled(false);
        if (transition === 'account') setScope('another-session');
        if (transition === 'disposed') dispose();
        return ok({
          rules: RULES,
          effect: '',
          broad_rule_indices: [],
          inactive_rule_indices: [],
        });
      });
      settings.beginEdit();
      await settings.save();
      expect(change).not.toHaveBeenCalled();
    }
  });

  it('uses the observed preview slot without silently re-reading it', async () => {
    const { settings, source } = mount();
    const preview = {
      preview_id: 'observed',
      context_id: 'context',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-01T00:05:00Z',
      status: 'running' as const,
      scanned_threads: 0,
      counts: {
        current: 0,
        proposed: 0,
        added: 0,
        removed: 0,
        retained: 0,
        denied: 0,
      },
    };
    vi.mocked(source.preview).mockResolvedValue(ok(preview));
    vi.mocked(source.startPreview).mockResolvedValue(
      err([{ code: 'CONFLICT', message: 'Preview changed' }])
    );
    settings.beginEdit();
    await settings.inspectPreview();
    await settings.startPreview();
    expect(settings.state.previewError).toBeUndefined();
    expect(source.preview).toHaveBeenCalledTimes(1);
    expect(source.startPreview).toHaveBeenCalledWith({
      rules: RULES,
      if_policy: INITIAL.token,
      if_preview_id: 'observed',
    });
    expect(settings.stale()).toBe(true);
    expect(settings.state.draft).toBe(JSON.stringify(RULES, null, 2));
  });

  it('revalidates a successful preview across retirement without replaying its POST', async () => {
    const { settings, source } = mount();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<EmailPolicySource['startPreview']>>
      >();
    const started = Promise.withResolvers<void>();
    vi.mocked(source.startPreview).mockImplementation(() => {
      started.resolve();
      return pending.promise;
    });
    settings.beginEdit();
    await settings.inspectPreview();
    const attempt = settings.startPreview();
    await started.promise;
    await cacheSessionGeneration.transition(async () => {});
    pending.resolve(
      ok({
        preview_id: 'stale',
        context_id: 'context',
        status: 'complete',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-01T00:05:00Z',
        scanned_threads: 1,
        counts: {
          current: 1,
          proposed: 1,
          added: 0,
          removed: 0,
          retained: 1,
          denied: 0,
        },
      })
    );
    await attempt;
    expect(source.startPreview).toHaveBeenCalledOnce();
    expect(source.preview).toHaveBeenCalledTimes(2);
    expect(settings.state.preview).toBeNull();
    expect(settings.state.previewDraft).toBeUndefined();
    expect(settings.state.draft).toBe(JSON.stringify(RULES, null, 2));
  });
});
