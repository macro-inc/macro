import { formatLocale, t } from '@app/lib/i18n';
import { type Accessor, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { SettingsCard, SettingsRow } from '../../settings/primitives';
import type { EmailPolicyAudit, EmailRuleSet } from '../context/email-policy';

export function policyTime(value: string) {
  return new Intl.DateTimeFormat(formatLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function policyActor(actor: EmailPolicyAudit['entry']['actor_kind']) {
  return match(actor)
    .with('member', () => t('crm.policyActorMember'))
    .with('agent', () => t('crm.policyActorAgent'))
    .with('api', () => t('crm.policyActorApi'))
    .with('system', () => t('crm.policyActorSystem'))
    .exhaustive(() => t('crm.policyActorUnknown'));
}

export function policyAction(action: EmailPolicyAudit['entry']['action']) {
  return match(action)
    .with('rules_activated', () => t('crm.policyActionRules'))
    .with('all_mail_enabled', () => t('crm.policyActionAll'))
    .with('withdrawn', () => t('crm.policyActionWithdraw'))
    .with('mailbox_revoked', () => t('crm.policyActionRevoke'))
    .with('live_targets_changed', () => t('crm.policyActionTargets'))
    .exhaustive(() => t('crm.policyActionUnknown'));
}

function ruleDisplay(rule: EmailRuleSet['include'][number]) {
  return match(rule)
    .with({ kind: 'domain' }, (r) => ({
      kind: t('crm.policyDomain'),
      value: r.domain,
      description: t('crm.policyDomainDescription'),
      id: undefined,
    }))
    .with({ kind: 'address' }, (r) => ({
      kind: t('crm.policyAddress'),
      value: r.address,
      description: t('crm.policyAddressDescription'),
      id: undefined,
    }))
    .with({ kind: 'contact' }, (r) => ({
      kind: t('crm.policyContact'),
      value: r.contact_id,
      description: t('crm.policyContactDescription'),
      id: r.contact_id,
    }))
    .with({ kind: 'company' }, (r) => ({
      kind: t('crm.policyCompany'),
      value: r.company_id,
      description: t('crm.policyCompanyDescription'),
      id: r.company_id,
    }))
    .with({ kind: 'thread' }, (r) => ({
      kind: t('crm.policyThread'),
      value: r.thread_id,
      description: t('crm.policyThreadDescription'),
      id: r.thread_id,
    }))
    .exhaustive(() => undefined);
}

export function EmailPolicyRules(props: {
  rules: EmailRuleSet;
  createName(
    rule: EmailRuleSet['include'][number]
  ): Accessor<string | undefined>;
}) {
  return (
    <SettingsCard>
      <For
        each={props.rules.include}
        fallback={
          <p class="px-4 py-3 text-sm text-ink-muted">{t('crm.policyEmpty')}</p>
        }
      >
        {(rule) => {
          const display = () => ruleDisplay(rule);
          const name = props.createName(rule);
          return (
            <Show when={display()}>
              {(row) => (
                <SettingsRow
                  class="flex-nowrap [&>div:first-child]:flex-1"
                  align="start"
                  label={
                    <span class="wrap-anywhere">
                      {name() ||
                        (row().id
                          ? `${row().kind} · …${row().value.slice(-6)}`
                          : row().value)}
                    </span>
                  }
                  description={
                    <>
                      {row().description}
                      <Show when={row().id && !name()}>
                        <span class="block">
                          {t('crm.policyUnavailableRecord')}
                        </span>
                      </Show>
                    </>
                  }
                >
                  <span class="whitespace-nowrap text-xs text-ink-muted pt-1">
                    {row().kind}
                  </span>
                </SettingsRow>
              )}
            </Show>
          );
        }}
      </For>
    </SettingsCard>
  );
}
