import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import { useCrmContext } from '../context/crm-context';
import type { EmailBlockScope } from '../core/email-privacy';

type PrivacySource = ReturnType<
  ReturnType<typeof useCrmContext>['createEmailPrivacy']
>;

function DomainBlocklist(props: {
  source: PrivacySource;
  scope: EmailBlockScope;
}) {
  const [domain, setDomain] = createSignal('');
  const settings = () =>
    props.source.query.isSuccess ? props.source.query.data : undefined;
  const domains = () =>
    props.scope === 'team'
      ? settings()?.teamDomains
      : settings()?.personalDomains;
  const canRemove = () =>
    props.scope === 'personal' || settings()?.canRemoveTeamDomains;
  const busy = () => props.source.update.isPending;
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    if (!domain().trim() || busy()) return;
    props.source.update.mutate(
      { action: 'add_domain', scope: props.scope, domain: domain().trim() },
      {
        onSuccess: () => setDomain(''),
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
            <SettingsRow label={item}>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canRemove() || busy()}
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
        <form onSubmit={add} class="flex gap-2 px-6 py-3">
          <input
            aria-label={
              props.scope === 'team'
                ? t('crm.privacyTeamDomainLabel')
                : t('crm.privacyPersonalDomainLabel')
            }
            class="settings-input min-w-0 flex-1"
            placeholder={t('crm.privacyDomainPlaceholder')}
            value={domain()}
            onInput={(e) => setDomain(e.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={busy() || !domain().trim()}
          >
            {t('crm.privacyAddDomain')}
          </Button>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

export function CrmEmailPrivacySettings(props: { onOptIn?: () => void }) {
  const source = useCrmContext().createEmailPrivacy();
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
            <span class="text-sm text-ink-muted">
              {settings()?.enabled ? t('crm.privacyOn') : t('crm.privacyOff')}
            </span>
          </SettingsRow>
        </SettingsCard>
        <p class="text-sm text-ink-muted">
          {t('crm.privacyConsentDescription')}
        </p>
      </SettingsSection>
      <DomainBlocklist source={source} scope="team" />
      <DomainBlocklist source={source} scope="personal" />
      <div class="flex justify-end">
        <Button
          variant={settings()?.enabled ? 'secondary' : 'primary'}
          disabled={
            (!settings()?.enabled && !settings()?.mailboxLinkId) ||
            source.update.isPending
          }
          onClick={() =>
            source.update.mutate(
              {
                action: 'set_consent',
                enabled: !settings()?.enabled,
                link_id: settings()?.mailboxLinkId,
              },
              { onSuccess: (data) => data.enabled && props.onOptIn?.() }
            )
          }
        >
          {settings()?.enabled ? t('crm.privacyStop') : t('crm.privacyShare')}
        </Button>
      </div>
    </Show>
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
          <CrmEmailPrivacySettings onOptIn={() => props.onOpenChange(false)} />
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
