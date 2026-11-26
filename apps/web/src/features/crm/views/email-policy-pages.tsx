import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import {
  EmailPolicyRules,
  policyAction,
  policyActor,
  policyTime,
} from '../components/email-policy-rules';
import type { EmailPolicySettings } from '../primitives/email-policy-settings';

export type EmailPolicyPage =
  | 'overview'
  | 'editor'
  | 'preview'
  | 'history'
  | 'revision'
  | 'format'
  | 'current'
  | 'mode'
  | 'all'
  | 'stopped';
type PageProps = {
  settings: EmailPolicySettings;
  page: EmailPolicyPage;
  go(page: EmailPolicyPage): void;
  stop(): void;
};

export function EmailPolicyNotices(props: {
  settings: EmailPolicySettings;
  onInspect(): void;
}) {
  const state = props.settings.state;
  return (
    <>
      <Show when={state.error}>
        <p class="text-sm text-failure whitespace-pre-wrap" role="alert">
          {state.error}
        </p>
      </Show>
      <Show when={props.settings.stale()}>
        <SettingsSection title={t('crm.policyConflictTitle')}>
          <p class="text-sm text-ink-muted">
            {t('crm.policyConflictDescription')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={state.busy}
            onClick={props.onInspect}
          >
            {t('crm.policyInspect')}
          </Button>
        </SettingsSection>
      </Show>
      <Show when={state.saved}>
        <p class="text-sm" role="status">
          {t('crm.policySaved')}
        </p>
      </Show>
      <Show when={state.saved && state.canonicalized}>
        <p class="text-sm text-ink-muted" role="status">
          {t('crm.policyCanonicalized')}
        </p>
      </Show>
      <For each={state.validation?.broad_rule_indices}>
        {(index) => (
          <p class="text-sm text-ink-muted" role="status">
            {t('crm.policyBroadWarning', { index: index + 1 })}
          </p>
        )}
      </For>
      <For each={state.validation?.inactive_rule_indices}>
        {(index) => (
          <p class="text-sm text-ink-muted" role="status">
            {t('crm.policyInactiveWarning', { index: index + 1 })}
          </p>
        )}
      </For>
    </>
  );
}

function Effects() {
  return (
    <>
      <p class="text-sm text-ink-muted leading-relaxed">
        {t('crm.policyEffect')}
      </p>
      <p class="text-sm text-ink-muted leading-relaxed">
        {t('crm.policyRecordsRemain')}
      </p>
    </>
  );
}

function Editor(props: PageProps) {
  const state = props.settings.state;
  return (
    <SettingsPage
      title={t('crm.policyEditorTitle')}
      description={t('crm.policyEditorDescription')}
      onBack={() => props.go('overview')}
      backLabel="CRM"
      showTitleInSheet
    >
      <EmailPolicyNotices
        settings={props.settings}
        onInspect={() => props.go('current')}
      />
      <Show when={!props.settings.canAuthor()}>
        <p class="text-sm text-ink-muted" role="status">
          {t('crm.policyGateOff')}
        </p>
      </Show>
      <SettingsSection title={t('crm.policyDefinition')}>
        <p class="text-sm text-ink-muted">{t('crm.policyFormatHelp')}</p>
        <textarea
          class="settings-input w-full min-h-80 resize-y rounded-xl font-mono text-xs leading-5 whitespace-pre-wrap"
          aria-label={t('crm.policyJsonLabel')}
          spellcheck={false}
          value={state.draft}
          readOnly={state.busy || !props.settings.canAuthor()}
          onInput={(e) => props.settings.edit(e.currentTarget.value)}
        />
        <Button variant="ghost" size="sm" onClick={() => props.go('format')}>
          {t('crm.policyFormat')}
        </Button>
      </SettingsSection>
      <SettingsSection title={t('crm.policyWhenSaved')}>
        <Effects />
        <p class="text-sm text-ink-muted">{t('crm.policySaveEffect')}</p>
      </SettingsSection>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => props.go('overview')}>
          {t('common.cancel')}
        </Button>
        <Show when={props.settings.canAuthor()}>
          <Button
            variant="secondary"
            disabled={state.busy}
            onClick={() => props.go('preview')}
          >
            {t('crm.policyPreview')}
          </Button>
        </Show>
        <Button
          variant="primary"
          disabled={!props.settings.canSave()}
          onClick={() => fireAndForget(props.settings.save(), 'crm')}
        >
          {state.busy ? t('crm.policySaving') : t('crm.policySave')}
        </Button>
      </div>
    </SettingsPage>
  );
}

const COUNT_KEYS = [
  'current',
  'proposed',
  'added',
  'removed',
  'retained',
  'denied',
] as const;
function countLabel(key: (typeof COUNT_KEYS)[number]) {
  return match(key)
    .with('current', () => t('crm.policyCountCurrent'))
    .with('proposed', () => t('crm.policyCountProposed'))
    .with('added', () => t('crm.policyCountAdded'))
    .with('removed', () => t('crm.policyCountRemoved'))
    .with('retained', () => t('crm.policyCountRetained'))
    .with('denied', () => t('crm.policyCountDenied'))
    .exhaustive();
}

function Preview(props: PageProps) {
  const state = props.settings.state;
  const preview = props.settings.preview;
  const running = () =>
    preview()?.status === 'pending' || preview()?.status === 'running';
  const title = () => {
    if (!preview()) return t('crm.policyPreviewReady');
    if (!props.settings.previewIsCurrent()) return t('crm.policyPreviewStale');
    return match(preview()?.status)
      .with('complete', () => t('crm.policyPreviewComplete'))
      .with('partial', () => t('crm.policyPreviewPartial'))
      .with('cancelled', () => t('crm.policyPreviewCancelled'))
      .otherwise(() => t('crm.policyPreviewRunning'));
  };
  return (
    <SettingsPage
      title={t('crm.policyPreviewTitle')}
      description={t('crm.policyPreviewDescription')}
      onBack={() => props.go('editor')}
      backLabel={t('crm.policyEditorTitle')}
      showTitleInSheet
    >
      <EmailPolicyNotices
        settings={props.settings}
        onInspect={() => props.go('current')}
      />
      <Show when={props.settings.previewFailed() && !state.previewError}>
        <p role="alert" class="text-sm text-failure">
          {t('crm.privacyLoadFailed')}
        </p>
      </Show>
      <Show when={state.previewError}>
        <p class="text-sm text-failure" role="alert">
          {state.previewError}
        </p>
      </Show>
      <SettingsSection title={title()}>
        <Show when={preview()}>
          {(result) => (
            <>
              <Show
                when={props.settings.previewIsCurrent()}
                fallback={
                  <p class="text-sm text-ink-muted">
                    {t('crm.policyPreviewStaleDescription')}
                  </p>
                }
              >
                <p class="text-sm text-ink-muted">
                  {t('crm.policyPreviewScanned', {
                    count: result().scanned_threads,
                  })}
                </p>
                <Show when={result().as_of}>
                  {(time) => (
                    <p class="text-sm text-ink-muted">
                      {t('crm.policyPreviewSnapshot', {
                        time: policyTime(time()),
                      })}
                    </p>
                  )}
                </Show>
                <Show when={result().status !== 'complete'}>
                  <p class="text-sm text-ink-muted">
                    {t('crm.policyPreviewLowerBounds')}
                  </p>
                </Show>
              </Show>
              <SettingsCard>
                <For each={COUNT_KEYS}>
                  {(key) => (
                    <SettingsRow label={countLabel(key)}>
                      <span class="tabular-nums text-sm">
                        {props.settings.previewIsCurrent()
                          ? result().status === 'complete'
                            ? new Intl.NumberFormat(formatLocale()).format(
                                result().counts[key] ?? 0
                              )
                            : t('crm.policyAtLeast', {
                                count: result().counts[key] ?? 0,
                              })
                          : '—'}
                      </span>
                    </SettingsRow>
                  )}
                </For>
              </SettingsCard>
            </>
          )}
        </Show>
        <p class="text-sm text-ink-muted">{t('crm.policyPreviewLive')}</p>
        <div class="flex flex-wrap gap-2">
          <Show when={props.settings.canAuthor()}>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                state.busy ||
                props.settings.stale() ||
                !props.settings.previewInspected()
              }
              onClick={() =>
                fireAndForget(props.settings.startPreview(), 'crm')
              }
            >
              {running()
                ? t('crm.policyPreviewReplace')
                : preview()
                  ? t('crm.policyPreviewAgain')
                  : t('crm.policyPreviewRun')}
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            disabled={state.busy}
            onClick={() =>
              fireAndForget(props.settings.inspectPreview(), 'crm')
            }
          >
            {t('crm.policyPreviewRefresh')}
          </Button>
          <Show when={running()}>
            <Button
              variant="ghost"
              size="sm"
              disabled={state.busy}
              onClick={() =>
                fireAndForget(props.settings.cancelPreview(), 'crm')
              }
            >
              {t('crm.policyPreviewCancel')}
            </Button>
          </Show>
        </div>
      </SettingsSection>
      <Effects />
      <div class="flex justify-end">
        <Button variant="secondary" onClick={() => props.go('editor')}>
          {t('crm.policyEditorTitle')}
        </Button>
      </div>
    </SettingsPage>
  );
}

function History(props: PageProps) {
  const state = props.settings.state;
  return (
    <SettingsPage
      title={t('crm.policyHistoryTitle')}
      description={t('crm.policyHistoryDescription')}
      onBack={() => props.go('overview')}
      backLabel="CRM"
      showTitleInSheet
    >
      <Show when={state.historyError}>
        <p role="alert" class="text-sm text-failure">
          {state.historyError}
        </p>
        <Button
          variant="ghost"
          onClick={() => fireAndForget(props.settings.loadHistory(), 'crm')}
        >
          {t('crm.privacyRetry')}
        </Button>
      </Show>
      <SettingsSection title={t('crm.policyHistoryRecent')}>
        <SettingsCard>
          <For
            each={state.history}
            fallback={
              <p class="px-4 py-3 text-sm text-ink-muted">
                {state.historyLoaded
                  ? t('crm.policyHistoryEmpty')
                  : t('crm.privacyLoading')}
              </p>
            }
          >
            {(event) => (
              <SettingsRow
                label={policyAction(event.entry.action)}
                description={t('crm.policyAttribution', {
                  actor: policyActor(event.entry.actor_kind),
                  time: policyTime(event.created_at),
                })}
                stackOnNarrow
              >
                <Show when={event.entry.next_revision}>
                  {(revision) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={state.busy}
                      onClick={() => {
                        props.go('revision');
                        fireAndForget(
                          props.settings.loadRevision(revision()),
                          'crm'
                        );
                      }}
                    >
                      {t('crm.policyViewRules')}
                    </Button>
                  )}
                </Show>
              </SettingsRow>
            )}
          </For>
        </SettingsCard>
        <Show when={state.before}>
          <Button
            variant="ghost"
            size="sm"
            disabled={state.busy}
            onClick={() =>
              fireAndForget(props.settings.loadHistory(true), 'crm')
            }
          >
            {t('crm.policyHistoryOlder')}
          </Button>
        </Show>
      </SettingsSection>
      <p class="text-sm text-ink-muted">{t('crm.policyHistoryReadOnly')}</p>
    </SettingsPage>
  );
}

export function EmailPolicyPages(props: PageProps) {
  const state = props.settings.state;
  return (
    <Switch>
      <Match when={props.page === 'editor'}>
        <Editor {...props} />
      </Match>
      <Match when={props.page === 'preview'}>
        <Preview {...props} />
      </Match>
      <Match when={props.page === 'history'}>
        <History {...props} />
      </Match>
      <Match when={props.page === 'current'}>
        <SettingsPage
          title={t('crm.policyReviewTitle')}
          description={t('crm.policyReviewDescription')}
          onBack={() => props.go('editor')}
          backLabel={t('crm.policyEditorTitle')}
          showTitleInSheet
        >
          <Show when={state.error}>
            <p role="alert" class="text-sm text-failure">
              {state.error}
            </p>
          </Show>
          <Show
            when={state.reviewed}
            fallback={
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() =>
                  fireAndForget(props.settings.inspectCurrent(), 'crm')
                }
              >
                {state.busy ? t('crm.privacyLoading') : t('crm.privacyRetry')}
              </Button>
            }
          >
            {(reviewed) => (
              <>
                <SettingsSection
                  title={
                    reviewed().enabled
                      ? reviewed().mode === 'selected'
                        ? t('crm.policySelected')
                        : t('crm.policyAll')
                      : t('crm.policyOff')
                  }
                >
                  <Show when={reviewed().rules}>
                    {(rules) => (
                      <EmailPolicyRules
                        rules={rules()}
                        createName={props.settings.createRuleName}
                      />
                    )}
                  </Show>
                </SettingsSection>
                <SettingsSection title={t('crm.policyDraft')}>
                  <pre class="whitespace-pre-wrap wrap-anywhere font-mono text-xs">
                    {state.draft}
                  </pre>
                </SettingsSection>
                <Button
                  variant="secondary"
                  disabled={!reviewed().token || state.busy}
                  onClick={() => {
                    if (props.settings.useReviewedDecision())
                      props.go('editor');
                  }}
                >
                  {t('crm.policyUseReviewed')}
                </Button>
              </>
            )}
          </Show>
        </SettingsPage>
      </Match>
      <Match when={props.page === 'revision'}>
        <SettingsPage
          title={t('crm.policyRevisionTitle')}
          onBack={() => props.go('history')}
          backLabel={t('crm.policyHistory')}
          showTitleInSheet
        >
          <Show when={state.historyError}>
            <p role="alert" class="text-sm text-failure">
              {state.historyError}
            </p>
          </Show>
          <Show
            when={state.revision}
            fallback={
              <p class="text-sm text-ink-muted">
                {state.revisionLoaded
                  ? t('crm.policyRevisionUnavailable')
                  : t('crm.privacyLoading')}
              </p>
            }
          >
            {(revision) => (
              <SettingsSection title={t('crm.policyDefinition')}>
                <pre class="font-mono text-xs whitespace-pre-wrap wrap-anywhere">
                  {JSON.stringify(revision().rules, null, 2)}
                </pre>
              </SettingsSection>
            )}
          </Show>
          <p class="text-sm text-ink-muted">
            {t('crm.policyRevisionDescription')}
          </p>
        </SettingsPage>
      </Match>
      <Match when={props.page === 'format'}>
        <SettingsPage
          title={t('crm.policyFormat')}
          onBack={() => props.go('editor')}
          backLabel={t('crm.policyEditorTitle')}
          showTitleInSheet
        >
          <SettingsSection title={t('crm.policyFormatTitle')}>
            <SettingsCard>
              <For
                each={[
                  'thread: thread_id',
                  'address: address',
                  'contact: contact_id',
                  'domain: domain',
                  'company: company_id',
                ]}
              >
                {(label) => <SettingsRow label={<code>{label}</code>} />}
              </For>
            </SettingsCard>
            <p class="text-sm text-ink-muted">
              {t('crm.policyFormatDescription')}
            </p>
            <p class="text-sm text-ink-muted">
              {t('crm.policyCompanyDescription')}
            </p>
          </SettingsSection>
        </SettingsPage>
      </Match>
      <Match when={props.page === 'mode'}>
        <SettingsPage
          title={t('crm.policyModeTitle')}
          description={t('crm.policyModeDescription')}
          onBack={() => props.go('overview')}
          backLabel="CRM"
          showTitleInSheet
        >
          <SettingsSection title={t('crm.privacyContributionTitle')}>
            <SettingsCard>
              <Show when={props.settings.canAuthor()}>
                <SettingsRow
                  label={t('crm.policyModeSelected')}
                  description={t('crm.policyChoices')}
                  stackOnNarrow
                >
                  <Button
                    variant="secondary"
                    onClick={() => props.go('editor')}
                  >
                    {t('crm.policyEdit')}
                  </Button>
                </SettingsRow>
                <SettingsRow
                  label={t('crm.policyModeAll')}
                  description={t('crm.policyModeAllDescription')}
                  stackOnNarrow
                >
                  <Button variant="secondary" onClick={() => props.go('all')}>
                    {t('crm.privacyReview')}
                  </Button>
                </SettingsRow>
              </Show>
              <Show when={props.settings.policy()?.enabled}>
                <SettingsRow label={t('crm.privacyOff')} stackOnNarrow>
                  <Button
                    variant="secondary"
                    disabled={state.busy}
                    onClick={props.stop}
                  >
                    {t('crm.privacyStop')}
                  </Button>
                </SettingsRow>
              </Show>
            </SettingsCard>
          </SettingsSection>
        </SettingsPage>
      </Match>
      <Match when={props.page === 'all'}>
        <SettingsPage
          title={t('crm.policyReviewAll')}
          onBack={() => props.go('mode')}
          backLabel={t('crm.policySharingOptions')}
          showTitleInSheet
        >
          <EmailPolicyNotices
            settings={props.settings}
            onInspect={() => props.go('current')}
          />
          <SettingsSection>
            <p class="text-sm text-ink-muted">
              {t('crm.policyReviewAllDescription', {
                mailbox: props.settings.policy()?.mailbox_email ?? '',
              })}
            </p>
          </SettingsSection>
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => props.go('overview')}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={
                !props.settings.canAuthor() ||
                state.busy ||
                props.settings.stale()
              }
              onClick={() => fireAndForget(enableAll(), 'crm')}
            >
              {t('crm.policyReviewAll')}
            </Button>
          </div>
        </SettingsPage>
      </Match>
      <Match when={props.page === 'stopped'}>
        <SettingsPage
          title={t('crm.policyStoppedTitle')}
          description={t('crm.policyStoppedDescription')}
          onBack={() => props.go('overview')}
          backLabel="CRM"
          showTitleInSheet
        >
          <SettingsSection title={t('crm.privacyContributionTitle')}>
            <SettingsCard>
              <SettingsRow
                label={
                  props.settings.policy()?.mailbox_email ??
                  t('crm.privacyConnect')
                }
                description={t('crm.policyOff')}
              />
            </SettingsCard>
            <p class="text-sm text-ink-muted">{t('crm.policyRecordsRemain')}</p>
            <p class="text-sm text-ink-muted">
              {t('crm.policyInboxConnected')}
            </p>
          </SettingsSection>
          <div class="flex justify-end">
            <Button variant="secondary" onClick={() => props.go('overview')}>
              {t('crm.policyBack')}
            </Button>
          </div>
        </SettingsPage>
      </Match>
    </Switch>
  );
  async function enableAll() {
    if (await props.settings.changeMode('enable_all')) props.go('overview');
  }
}
