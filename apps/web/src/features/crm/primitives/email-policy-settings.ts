import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { startUiOperation } from '@app/observability/ui-operation';
import { deepEqual } from '@core/util/compareUtils';
import type { ResultError } from '@core/util/result';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { Span } from '@macro-inc/observability';
import { Result } from 'neverthrow';
import { type Accessor, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  EmailPolicyAudit,
  EmailPolicyCommand,
  EmailPolicyRevision,
  EmailPolicySource,
  EmailPolicyToken,
  EmailPolicyView,
  EmailPreviewView,
  EmailRuleValidation,
} from '../context/email-policy';

type SettingsState = {
  draft: string;
  token?: EmailPolicyToken;
  editing: boolean;
  busy: boolean;
  conflict: boolean;
  error?: string;
  validation?: EmailRuleValidation;
  canonicalized: boolean;
  saved: boolean;
  reviewed?: EmailPolicyView;
  preview?: EmailPreviewView | null;
  previewInspected: boolean;
  previewDraft?: string;
  previewError?: string;
  history: EmailPolicyAudit[];
  historyLoaded: boolean;
  historyError?: string;
  before?: string | null;
  revision?: EmailPolicyRevision | null;
  revisionLoaded: boolean;
};

const EMPTY_RULES = { schema_version: 1, include: [] };
const parseJson = Result.fromThrowable((json: string): unknown =>
  JSON.parse(json)
);

/** A decision is pinned when editing starts, not whenever a query refreshes. */
export function createEmailPolicySettings(
  source: EmailPolicySource,
  gate: Accessor<boolean>,
  previewActive: Accessor<boolean> = () => false
) {
  const owner = source.scope();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const current = () => !disposed && !!owner && source.scope() === owner;
  const policy = () => (source.query.isPending ? undefined : source.query.data);
  const canAuthor = () =>
    current() && gate() && !!policy()?.authoring_available;
  const previewQuery = source.createPreview(previewActive);
  usePending('crm.email_policy.preview.load', () => previewQuery.isLoading);
  const [state, setState] = createStore<SettingsState>({
    draft: '',
    editing: false,
    busy: false,
    conflict: false,
    canonicalized: false,
    saved: false,
    previewInspected: false,
    history: [],
    historyLoaded: false,
    revisionLoaded: false,
  });
  const stale = () =>
    state.conflict ||
    (state.editing &&
      !!state.token &&
      !!policy()?.token &&
      !deepEqual(state.token, policy()?.token));
  const canSave = () =>
    canAuthor() && !!state.token && !state.busy && !stale() && !state.saved;

  const preview = () =>
    !previewQuery.isPending ? previewQuery.data : state.preview;
  const previewInspected = () =>
    previewQuery.isSuccess || state.previewInspected;

  function failure(
    errors: ResultError[],
    target: 'error' | 'previewError' = 'error'
  ) {
    if (errors.some((e) => e.code === 'CONFLICT')) {
      setState(target, undefined);
      setState('conflict', true);
      return;
    }
    setState(target, errors.map((e) => e.message).join('\n'));
  }

  function beginEdit() {
    if (!current() || state.busy || state.editing) return;
    const view = policy();
    if (!view) return;
    setState({
      draft: JSON.stringify(view.rules ?? EMPTY_RULES, null, 2),
      token: view.token ?? undefined,
      editing: true,
      conflict: false,
      error: undefined,
      validation: undefined,
      saved: false,
      reviewed: undefined,
    });
  }

  function edit(draft: string) {
    if (!current() || state.busy) return;
    setState({
      draft,
      saved: false,
      validation: undefined,
      canonicalized: false,
      error: undefined,
    });
  }

  async function save() {
    if (!canSave()) return false;
    const operation = startUiOperation('crm.email_policy.save', {
      attributes: { 'crm.mailbox.id': policy()?.link_id ?? '' },
    });
    try {
      const saved = await operation.run(() => saveDecision(operation.span));
      if (saved) operation.afterPaint();
      else operation.finish('error');
      return saved;
    } catch (error) {
      operation.span.error('CRM policy save failed');
      operation.finish('error');
      throw error;
    }
  }

  async function saveDecision(parent: Span) {
    const token = state.token;
    if (!token) return false;
    const draft = state.draft;
    const parsed = parseJson(draft);
    if (parsed.isErr()) {
      setState('error', t('crm.policyInvalidJson'));
      return false;
    }
    setState({ busy: true, error: undefined, validation: undefined });
    const validated = await parent.span('crm.email_policy.validate', () =>
      source.validate(draft)
    );
    if (!current()) return false;
    if (validated.isErr()) {
      failure(validated.error);
      setState('busy', false);
      return false;
    }
    setState({
      validation: validated.value,
      canonicalized: !deepEqual(parsed.value, validated.value.rules),
    });
    // Validation is read-only. A gate, account or decision change during it
    // must prevent the following activation, even when validation succeeded.
    if (!canAuthor() || stale() || draft !== state.draft) {
      setState('busy', false);
      return false;
    }
    const result = await parent.run(() =>
      source.change({
        change: { action: 'replace_rules', rules: validated.value.rules },
        if_policy: token,
        request_id: crypto.randomUUID(),
      })
    );
    if (!current()) return false;
    setState('busy', false);
    if (result.isErr()) {
      failure(result.error);
      // An uncertain write may have committed. Inspect before another decision,
      // rather than create a new idempotency key and submit the old intent.
      if (
        result.error.some((e) =>
          [
            'NETWORK_ERROR',
            'SERVER_ERROR',
            'UNKNOWN',
            'UNKNOWN_ERROR',
          ].includes(e.code)
        )
      )
        setState('conflict', true);
      return false;
    }
    setState({
      saved: true,
      token: result.value.token,
      draft: JSON.stringify(validated.value.rules, null, 2),
      previewDraft: undefined,
      historyLoaded: false,
    });
    return true;
  }

  async function changeMode(action: 'enable_all' | 'withdraw') {
    if (
      !current() ||
      state.busy ||
      stale() ||
      (action === 'enable_all' && !canAuthor())
    )
      return false;
    const token = state.token ?? policy()?.token;
    if (!token) return false;
    setState({ busy: true, error: undefined });
    const command: EmailPolicyCommand = {
      change: { action },
      if_policy: token,
      request_id: crypto.randomUUID(),
    };
    const result = await source.change(command);
    if (!current()) return false;
    setState('busy', false);
    if (result.isErr()) {
      failure(result.error);
      return false;
    }
    setState({
      token: result.value.token,
      editing: false,
      saved: false,
      previewDraft: undefined,
      historyLoaded: false,
    });
    return true;
  }

  async function inspectCurrent() {
    if (!current() || state.busy) return;
    setState({ busy: true, error: undefined, reviewed: undefined });
    const result = await source.read();
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) return failure(result.error);
    setState('reviewed', result.value);
  }

  function useReviewedDecision() {
    const view = state.reviewed;
    if (
      !current() ||
      state.busy ||
      !view?.token ||
      !deepEqual(view.token, policy()?.token)
    )
      return false;
    // Only this explicit comparison action admits a fresh token. Keep the draft.
    setState({
      token: view.token,
      conflict: false,
      saved: false,
      reviewed: undefined,
      error: undefined,
    });
    return true;
  }

  async function inspectPreview() {
    if (!current() || state.busy) return;
    setState({ busy: true, previewError: undefined });
    const result = await source.preview();
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) return failure(result.error, 'previewError');
    if (result.value?.preview_id !== state.preview?.preview_id)
      setState('previewDraft', undefined);
    setState({ preview: result.value, previewInspected: true });
  }

  async function startPreview() {
    const operation = startUiOperation('crm.email_policy.preview.start');
    try {
      await operation.run(() => startPreviewDecision(operation.span));
      if (state.previewError || stale()) operation.finish('error');
      else operation.afterPaint();
    } catch (error) {
      operation.span.error('CRM policy preview failed');
      operation.finish('error');
      throw error;
    }
  }

  async function startPreviewDecision(parent: Span) {
    if (
      !canAuthor() ||
      state.busy ||
      stale() ||
      !previewInspected() ||
      !state.token
    )
      return;
    const token = state.token;
    const draft = state.draft;
    const observedId = preview()?.preview_id ?? null;
    if (parseJson(draft).isErr()) {
      setState('previewError', t('crm.policyInvalidJson'));
      return;
    }
    setState({ busy: true, previewError: undefined });
    const validated = await parent.span('crm.email_policy.validate', () =>
      source.validate(draft)
    );
    if (!current()) return;
    if (validated.isErr()) {
      failure(validated.error, 'previewError');
      setState('busy', false);
      return;
    }
    if (!canAuthor() || stale()) {
      setState('busy', false);
      return;
    }
    const generation = cacheSessionGeneration.capture();
    const result = await parent.run(() =>
      source.startPreview({
        if_policy: token,
        if_preview_id: observedId,
        rules: validated.value.rules,
      })
    );
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) return failure(result.error, 'previewError');
    // The POST succeeded; re-read its result after retirement instead of
    // publishing old response content or replaying the command.
    if (!cacheSessionGeneration.isCurrent(generation)) {
      await parent.run(() => inspectPreview());
      return;
    }
    setState({ preview: result.value, previewDraft: draft });
  }

  async function cancelPreview() {
    const id = preview()?.preview_id;
    if (!current() || state.busy || !id) return;
    setState({ busy: true, previewError: undefined });
    const result = await source.cancelPreview(id);
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) return failure(result.error, 'previewError');
    await inspectPreview();
  }

  async function loadHistory(older = false) {
    if (!current() || state.busy || (older && !state.before)) return;
    setState({ busy: true, historyError: undefined });
    const result = await source.history(
      older ? (state.before ?? undefined) : undefined
    );
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) {
      setState('historyError', result.error.map((e) => e.message).join('\n'));
      return;
    }
    const events = older
      ? [...state.history, ...result.value.events]
      : result.value.events;
    setState({
      history: events.filter(
        (event, index) =>
          events.findIndex(
            (other) => other.entry.event_id === event.entry.event_id
          ) === index
      ),
      before: result.value.next_cursor,
      historyLoaded: true,
    });
  }

  async function loadRevision(revision: number) {
    if (!current() || state.busy) return;
    setState({
      busy: true,
      revisionLoaded: false,
      revision: undefined,
      historyError: undefined,
    });
    const result = await source.revision(revision);
    if (!current()) return;
    setState('busy', false);
    if (result.isErr()) {
      setState('historyError', result.error.map((e) => e.message).join('\n'));
      return;
    }
    setState({ revision: result.value, revisionLoaded: true });
  }

  return {
    state,
    createRuleName: source.createRuleName,
    policy,
    canAuthor,
    canSave,
    stale,
    beginEdit,
    edit,
    save,
    changeMode,
    inspectCurrent,
    useReviewedDecision,
    inspectPreview,
    startPreview,
    cancelPreview,
    loadHistory,
    loadRevision,
    preview,
    previewInspected,
    previewFailed: () => previewQuery.isError,
    previewIsCurrent: () =>
      state.previewDraft === state.draft &&
      !stale() &&
      preview()?.preview_id === state.preview?.preview_id &&
      preview()?.status !== 'stale',
  };
}

export type EmailPolicySettings = ReturnType<typeof createEmailPolicySettings>;
