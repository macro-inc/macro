import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import {
  enableCrmSelectiveEmailContribution,
  enableCrmThreadExclusions,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Dialog, Panel } from '@ui';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import {
  EmailPolicyRules,
  policyActor,
  policyTime,
} from '../components/email-policy-rules';
import { useCrmContext } from '../context/crm-context';
import type { EmailPolicySource } from '../context/email-policy';
import type {
  EmailBlockScope,
  MailboxDomainConflict,
} from '../core/email-privacy';
import { createEmailPolicySettings } from '../primitives/email-policy-settings';
import {
  EmailPolicyNotices,
  type EmailPolicyPage,
  EmailPolicyPages,
} from './email-policy-pages';

type PrivacySource = ReturnType<
  ReturnType<typeof useCrmContext>['createEmailPrivacy']
>;

function domainWarningText(reason: MailboxDomainConflict | undefined) {
  if (!reason) return undefined;
  return match(reason)
    .with('company', () => t('crm.privacyCompanyMailboxDomain'))
    .with('personal_provider', () => t('crm.privacyPersonalMailboxDomain'))
    .exhaustive(() => undefined);
}

function DomainBlocklist(props: {
  source: PrivacySource;
  scope: EmailBlockScope;
}) {
  const [input, setInput] = createStore<{ domain: string; error?: string }>({
    domain: '',
  });
  const errorId = createUniqueId();
  const settings = () =>
    props.source.query.isPending ? undefined : props.source.query.data;
  const domains = () =>
    props.scope === 'team'
      ? settings()?.teamDomains
      : settings()?.personalDomains;
  const canRemove = () =>
    props.scope === 'personal' || settings()?.canRemoveTeamDomains;
  const warnings = () =>
    props.scope === 'team'
      ? settings()?.teamDomainWarnings
      : settings()?.personalDomainWarnings;
  const busy = () => props.source.update.isPending;
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const domain = input.domain.trim();
    if (!domain || busy()) return;
    setInput('error', undefined);
    props.source.update.mutate(
      { action: 'add_domain', scope: props.scope, domain },
      {
        onSuccess: () => {
          if (input.domain.trim() === domain)
            setInput({ domain: '', error: undefined });
        },
        onError: (error) => {
          if (input.domain.trim() === domain)
            setInput('error', error.message || t('crm.privacyUpdateFailed'));
        },
      }
    );
  };
  return (
    <SettingsSection
      title={
        props.scope === 'team'
          ? t('crm.privacyTeamTitle')
          : t('crm.privacyPersonalTitle')
      }
    >
      <p class="text-sm text-ink-muted">
        {props.scope === 'team'
          ? t('crm.privacyTeamDescription')
          : t('crm.privacyPersonalDescription')}{' '}
        {t('crm.privacyDomainDescription')}
      </p>
      <SettingsCard>
        <For
          each={domains()}
          fallback={
            <p class="px-6 py-3 text-sm text-ink-muted">
              {t('crm.privacyNoDomains')}
            </p>
          }
        >
          {(item) => (
            <SettingsRow
              label={item}
              description={domainWarningText(warnings()?.[item])}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={!canRemove() || busy()}
                aria-label={t('crm.privacyRemoveDomain', { domain: item })}
                onClick={() =>
                  props.source.update.mutate({
                    action: 'remove_domain',
                    scope: props.scope,
                    domain: item,
                  })
                }
              >
                {t('crm.privacyRemove')}
              </Button>
            </SettingsRow>
          )}
        </For>
        <form onSubmit={add} class="flex flex-col gap-2 px-6 py-3">
          <div class="flex gap-2">
            <input
              aria-label={
                props.scope === 'team'
                  ? t('crm.privacyTeamDomainLabel')
                  : t('crm.privacyPersonalDomainLabel')
              }
              class="settings-input min-w-0 flex-1"
              aria-invalid={!!input.error}
              aria-describedby={input.error ? errorId : undefined}
              placeholder={t('crm.privacyDomainPlaceholder')}
              value={input.domain}
              onInput={(e) =>
                setInput({ domain: e.currentTarget.value, error: undefined })
              }
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={busy() || !input.domain.trim()}
            >
              {t('crm.privacyAddDomain')}
            </Button>
          </div>
          <Show when={input.error}>
            <p id={errorId} class="text-sm text-failure" role="alert">
              {input.error}
            </p>
          </Show>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

function ThreadExclusions(props: {
  source: PrivacySource;
  onOpenThread?: () => void;
}) {
  const { EmailThreadMention } = useCrmContext();
  const [after, setAfter] = createSignal<string>();
  const query = props.source.createExcludedThreads(after);
  return (
    <SettingsSection title={t('crm.privacyThreadsTitle')}>
      <p class="text-sm text-ink-muted">{t('crm.privacyThreadsDescription')}</p>
      <Show
        when={!query.isPending && query.data}
        fallback={
          <p class="text-sm text-ink-muted" role="status">
            {query.isError
              ? t('crm.privacyLoadFailed')
              : t('crm.privacyLoading')}
            <Show when={query.isError}>
              <Button
                variant="ghost"
                onClick={() => fireAndForget(query.refetch(), 'crm')}
              >
                {t('crm.privacyRetry')}
              </Button>
            </Show>
          </p>
        }
      >
        <Show when={query.isError}>
          <p class="text-sm text-ink-muted" role="status">
            {t('crm.privacyLoadFailed')}
            <Button
              variant="ghost"
              onClick={() => fireAndForget(query.refetch(), 'crm')}
            >
              {t('crm.privacyRetry')}
            </Button>
          </p>
        </Show>
        <SettingsCard>
          <For
            each={query.data?.threads}
            fallback={
              <p class="px-6 py-3 text-sm text-ink-muted">
                {t('crm.privacyNoThreads')}
              </p>
            }
          >
            {(thread) => (
              <SettingsRow
                label={
                  <EmailThreadMention
                    threadId={thread.threadId}
                    subject={thread.subject || t('crm.privacyThreadNoSubject')}
                    onOpened={props.onOpenThread}
                  />
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.source.update.isPending}
                  aria-label={t('crm.privacyRestoreThreadLabel', {
                    subject: thread.subject || t('crm.privacyThreadNoSubject'),
                  })}
                  onClick={() =>
                    props.source.update.mutate({
                      action: 'set_thread_exclusion',
                      thread_id: thread.threadId,
                      excluded: false,
                    })
                  }
                >
                  {t('crm.privacyRestoreThread')}
                </Button>
              </SettingsRow>
            )}
          </For>
        </SettingsCard>
        <div class="flex justify-end gap-2">
          <Show when={after()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAfter(undefined)}
            >
              {t('crm.privacyThreadsFirst')}
            </Button>
          </Show>
          <Show when={query.data?.nextCursor}>
            {(cursor) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAfter(cursor())}
              >
                {t('crm.privacyThreadsNext')}
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </SettingsSection>
  );
}

/**
 * Opens the app's add-inbox flow. Connecting a mailbox never opts it in; the
 * member shares it separately afterwards.
 */
function ConnectEmailButton(props: { onConnectEmail?: () => void }) {
  const { connectMailbox } = useCrmContext();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        props.onConnectEmail?.();
        connectMailbox();
      }}
    >
      {t('crm.privacyConnectEmail')}
    </Button>
  );
}

function LegacyEmailPrivacySettings(props: {
  onOptIn?: () => void;
  onConnectEmail?: () => void;
  onOpenThread?: () => void;
  source: PrivacySource;
  policyUnavailable?: boolean;
}) {
  const threadExclusions = useFeatureFlag(enableCrmThreadExclusions);
  const source = props.source;
  const settings = () =>
    source.query.isSuccess ? source.query.data : undefined;
  return (
    <Show
      when={settings()}
      fallback={
        <p class="text-sm text-ink-muted" role="status">
          {source.query.isError
            ? t('crm.privacyLoadFailed')
            : t('crm.privacyLoading')}
          <Show when={source.query.isError}>
            <Button
              variant="ghost"
              onClick={() => fireAndForget(source.query.refetch(), 'crm')}
            >
              {t('crm.privacyRetry')}
            </Button>
          </Show>
        </p>
      }
    >
      <SettingsSection title={t('crm.privacyContributionTitle')}>
        <p class="text-sm text-ink-muted">{t('crm.privacyAvailability')}</p>
        <SettingsCard>
          <SettingsRow
            label={settings()?.mailboxEmail ?? t('crm.privacyConnect')}
            description={
              settings()?.enabled
                ? t('crm.privacyShared')
                : t('crm.privacyNotShared')
            }
          >
            <Show
              when={settings()?.mailboxEmail}
              fallback={
                <ConnectEmailButton onConnectEmail={props.onConnectEmail} />
              }
            >
              <span class="text-sm text-ink-muted">
                {settings()?.enabled ? t('crm.privacyOn') : t('crm.privacyOff')}
              </span>
            </Show>
          </SettingsRow>
        </SettingsCard>
        <p class="text-sm text-ink-muted">
          {t('crm.privacyConsentDescription')}
        </p>
      </SettingsSection>
      <DomainBlocklist source={source} scope="team" />
      <DomainBlocklist source={source} scope="personal" />
      <Show when={threadExclusions().enabled}>
        <ThreadExclusions source={source} onOpenThread={props.onOpenThread} />
      </Show>
      <div class="flex justify-end">
        <Button
          variant={settings()?.enabled ? 'secondary' : 'primary'}
          disabled={
            (!settings()?.enabled &&
              (!settings()?.mailboxLinkId || props.policyUnavailable)) ||
            source.update.isPending
          }
          onClick={() => {
            if (!settings()?.enabled && props.policyUnavailable) return;
            source.update.mutate(
              {
                action: 'set_consent',
                enabled: !settings()?.enabled,
                link_id: settings()?.mailboxLinkId,
              },
              { onSuccess: (data) => data.enabled && props.onOptIn?.() }
            );
          }}
        >
          {settings()?.enabled ? t('crm.privacyStop') : t('crm.privacyShare')}
        </Button>
      </div>
    </Show>
  );
}

type PrivacySettingsProps = {
  onOptIn?: () => void;
  /** Called before the add-inbox flow opens, so a host dialog can step aside. */
  onConnectEmail?: () => void;
  onOpenThread?: () => void;
  renderOverview?: (content: JSX.Element) => JSX.Element;
};

function SelectiveEmailPrivacy(
  props: PrivacySettingsProps & {
    source: PrivacySource;
    policySource: EmailPolicySource;
  }
) {
  const exclusions = useFeatureFlag(enableCrmThreadExclusions);
  const flag = useFeatureFlag(enableCrmSelectiveEmailContribution);
  const [page, setPage] = createSignal<EmailPolicyPage>('overview');
  const settings = createEmailPolicySettings(
    props.policySource,
    () => !!flag().enabled,
    () => page() === 'preview'
  );
  usePending(
    'crm.email_policy.history',
    () => !settings.state.historyLoaded && !settings.state.historyError
  );
  const policy = settings.policy;
  const mailbox = () => policy()?.mailbox_email;
  const go = (next: EmailPolicyPage) => {
    if (settings.state.busy) return;
    if (next === 'editor' || next === 'preview' || next === 'all')
      settings.beginEdit();
    setPage(next);
    if (next === 'preview') fireAndForget(settings.inspectPreview(), 'crm');
    if (next === 'current') fireAndForget(settings.inspectCurrent(), 'crm');
    if (next === 'history' || next === 'overview')
      fireAndForget(settings.loadHistory(), 'crm');
  };
  onMount(() => fireAndForget(settings.loadHistory(), 'crm'));
  const stop = () =>
    props.source.update.mutate(
      { action: 'set_consent', enabled: false },
      { onSuccess: () => setPage('stopped') }
    );
  const attribution = () =>
    settings.state.history.find(
      (event) =>
        event.entry.next_revision === policy()?.revision &&
        event.entry.action === 'rules_activated'
    );
  const overview = () => (
    <>
      <EmailPolicyNotices settings={settings} onInspect={() => go('current')} />
      <SettingsSection title={t('crm.privacyContributionTitle')}>
        <SettingsCard>
          <SettingsRow
            label={mailbox() ?? t('crm.privacyConnect')}
            description={
              !policy()?.enabled
                ? t('crm.policyOff')
                : policy()?.mode === 'selected'
                  ? t('crm.policySelected')
                  : t('crm.policyAll')
            }
          >
            <div class="flex flex-wrap justify-end gap-2">
              <Show when={!mailbox()}>
                <ConnectEmailButton onConnectEmail={props.onConnectEmail} />
              </Show>
              <Show when={settings.canAuthor()}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={settings.state.busy}
                  onClick={() => go('mode')}
                >
                  {t('crm.policyChange')}
                </Button>
              </Show>
            </div>
          </SettingsRow>
        </SettingsCard>
        <p class="text-sm text-ink-muted leading-relaxed">
          {!policy()?.enabled
            ? t('crm.privacyNotShared')
            : policy()?.mode === 'selected'
              ? t('crm.policySelectedDescription')
              : t('crm.policyAllDescription')}
        </p>
      </SettingsSection>
      <SettingsSection
        title={t('crm.policyRules')}
        actions={
          <Show when={settings.canAuthor() && policy()?.rules}>
            <Button
              variant="secondary"
              size="sm"
              disabled={settings.state.busy}
              onClick={() => go('editor')}
            >
              {t('crm.policyEdit')}
            </Button>
          </Show>
        }
      >
        <Show
          when={policy()?.rules}
          fallback={
            <SettingsRow
              label={t('crm.policyChoose')}
              description={t('crm.policyChoices')}
              stackOnNarrow
            >
              <Show when={settings.canAuthor()}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={settings.state.busy || !policy()?.token}
                  onClick={() => go('editor')}
                >
                  {t('crm.policySetup')}
                </Button>
              </Show>
            </SettingsRow>
          }
        >
          {(rules) => (
            <>
              <p class="text-sm text-ink-muted">
                {t('crm.policyRuleDescription')}
              </p>
              <EmailPolicyRules
                rules={rules()}
                createName={settings.createRuleName}
              />
            </>
          )}
        </Show>
        <Show when={!settings.canAuthor()}>
          <p class="text-sm text-ink-muted">{t('crm.policyGateOff')}</p>
        </Show>
        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Show when={attribution()}>
            {(event) => (
              <p class="text-xs text-ink-muted">
                {t('crm.policyUpdated', {
                  actor: policyActor(event().entry.actor_kind),
                  time: policyTime(event().created_at),
                })}
              </p>
            )}
          </Show>
          <div class="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={settings.state.busy}
              onClick={() => go('history')}
            >
              {t('crm.policyHistory')}
            </Button>
            <Show when={settings.canAuthor()}>
              <Button
                variant="secondary"
                size="sm"
                disabled={settings.state.busy || !policy()?.token}
                onClick={() => go('preview')}
              >
                {t('crm.policyPreview')}
              </Button>
            </Show>
          </div>
        </div>
      </SettingsSection>
      <Show when={props.source.query.isPending || props.source.query.isError}>
        <p class="text-sm text-ink-muted" role="status">
          {props.source.query.isError
            ? t('crm.privacyLoadFailed')
            : t('crm.privacyLoading')}
          <Show when={props.source.query.isError}>
            <Button
              variant="ghost"
              onClick={() => fireAndForget(props.source.query.refetch(), 'crm')}
            >
              {t('crm.privacyRetry')}
            </Button>
          </Show>
        </p>
      </Show>
      <Show when={!props.source.query.isPending && props.source.query.data}>
        <DomainBlocklist source={props.source} scope="team" />
        <DomainBlocklist source={props.source} scope="personal" />
      </Show>
      <Show when={exclusions().enabled}>
        <ThreadExclusions
          source={props.source}
          onOpenThread={props.onOpenThread}
        />
      </Show>
      <p class="text-sm text-ink-muted leading-relaxed">
        {t('crm.policyRecordsRemain')}
      </p>
      <Show when={policy()?.enabled}>
        <div class="flex justify-end">
          <Button
            variant="secondary"
            disabled={props.source.update.isPending || settings.state.busy}
            onClick={stop}
          >
            {t('crm.privacyStop')}
          </Button>
        </div>
      </Show>
    </>
  );
  return (
    <Show
      when={page() === 'overview'}
      fallback={
        <EmailPolicyPages
          settings={settings}
          page={page()}
          go={go}
          stop={stop}
        />
      }
    >
      {props.renderOverview ? props.renderOverview(overview()) : overview()}
    </Show>
  );
}

export function CrmEmailPrivacySettings(props: PrivacySettingsProps) {
  const flag = useFeatureFlag(enableCrmSelectiveEmailContribution);
  const context = useCrmContext();
  const source = context.createEmailPrivacy();
  const policySource = context.createEmailPolicy();
  usePending('crm.email_policy.load', () => policySource.query.isLoading);
  const policy = () =>
    policySource.query.isPending ? undefined : policySource.query.data;
  const legacy = () => (
    <LegacyEmailPrivacySettings
      {...props}
      source={source}
      policyUnavailable={policySource.query.isError && !policy()}
    />
  );
  const renderOverview = (content: JSX.Element) =>
    props.renderOverview ? props.renderOverview(content) : content;
  return (
    <Switch>
      <Match
        when={
          flag().loading ||
          (policySource.query.isPending && !policySource.query.isError)
        }
      >
        {renderOverview(
          <p role="status" class="text-sm text-ink-muted">
            {t('crm.privacyLoading')}
          </p>
        )}
      </Match>
      <Match when={policySource.query.isError && !policy()}>
        {renderOverview(
          <>
            <p role="alert" class="text-sm text-failure">
              {t('crm.privacyLoadFailed')}
            </p>
            <Button
              variant="ghost"
              onClick={() => fireAndForget(policySource.query.refetch(), 'crm')}
            >
              {t('crm.privacyRetry')}
            </Button>
            {legacy()}
          </>
        )}
      </Match>
      <Match when={!flag().enabled && policy()?.mode !== 'selected'}>
        {renderOverview(legacy())}
      </Match>
      <Match when={policySource.scope()}>
        {(scope) => (
          <Show when={scope()} keyed>
            {(_scope) => (
              <SelectiveEmailPrivacy
                {...props}
                source={source}
                policySource={policySource}
              />
            )}
          </Show>
        )}
      </Match>
    </Switch>
  );
}

export function CrmEmailOptInBanner() {
  const source = useCrmContext().createEmailPrivacy();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <Show when={source.query.isSuccess && !source.query.data?.enabled}>
        <div class="min-h-5 shrink-0 flex flex-wrap items-center justify-center gap-x-2 bg-accent/10 px-3 py-0.5 text-xs text-ink">
          <span>{t('crm.privacyBanner')}</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {t('crm.privacyReview')}
          </Button>
        </div>
      </Show>
      <CrmEmailPrivacyDialog open={open()} onOpenChange={setOpen} />
    </>
  );
}

export function CrmEmailPrivacyDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  let title: HTMLElement | undefined;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      onOpenAutoFocus={(event) => {
        // Start with the mailbox and consent terms, rather than scrolling a
        // phone drawer to its first editable exclusion field.
        event.preventDefault();
        title?.focus({ preventScroll: true });
      }}
      class="w-[min(640px,95vw)] max-h-[85vh]"
    >
      <Panel depth={2} class="max-h-[85vh] text-ink rounded-xl">
        <Panel.Header class="px-4 py-3 flex items-center justify-between gap-4">
          <Dialog.Title
            ref={(element) => {
              title = element;
            }}
            tabIndex={-1}
            class="text-base font-medium"
          >
            {t('crm.privacyDialogTitle')}
          </Dialog.Title>
          <Dialog.CloseButton as={Button} variant="ghost" size="sm">
            {t('crm.privacyClose')}
          </Dialog.CloseButton>
        </Panel.Header>
        <Panel.Body scroll class="p-4 flex flex-col gap-4">
          <CrmEmailPrivacySettings
            onOptIn={() => props.onOpenChange(false)}
            onConnectEmail={() => props.onOpenChange(false)}
            onOpenThread={() => props.onOpenChange(false)}
          />
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
