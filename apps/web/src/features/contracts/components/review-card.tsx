import { t } from '@app/lib/i18n';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import SignatureIcon from '@icon/system/regular/signature.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Avatar, Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { ContractDatabase } from '../core/database';
import { fieldsFor } from '../core/fields';
import { type Packet, signers } from '../core/packet';
import { initialsOf } from './format';
import { PacketStatusPill } from './packet-status-pill';
import { recipientTone, toneVars } from './tone';

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-11 items-center gap-2 border-t border-edge-muted py-1.5">
      <span class="w-19 shrink-0 text-xs text-ink-extra-muted">
        {props.label}
      </span>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
        {props.children}
      </div>
    </div>
  );
}

/**
 * The last look before a packet goes out: what is being sent, to whom, where
 * it lives, and what stops it from sending. The agent pane shows the same
 * card when an agent prepares a packet.
 */
export function ReviewCard(props: {
  packet: Packet;
  databases: readonly ContractDatabase[];
  /** Problems to show; sending is disabled while `blocked`. */
  warnings: string[];
  blocked: boolean;
  sending: boolean;
  onEdit: () => void;
  onSend: () => void;
}) {
  const firstSigner = () => signers(props.packet)[0];

  return (
    <article
      aria-label={t('contracts.reviewTitle')}
      class="rounded-[28px] border border-edge-muted bg-composer px-4 pt-1.5 pb-3.5"
    >
      <div class="flex min-h-11 items-center gap-2">
        <SignatureIcon class="size-4 text-ink-muted" />
        <h2 class="flex-1 text-sm font-medium">{t('contracts.reviewTitle')}</h2>
        <PacketStatusPill status="draft" />
      </div>

      <Row label={t('contracts.columnPacket')}>
        <span class="text-[0.9375rem] font-medium">{props.packet.title}</span>
      </Row>

      <Row label={t('contracts.documents')}>
        <For each={props.packet.documents}>
          {(document) => (
            <span class="inline-flex h-7 items-center gap-2 rounded-lg bg-ink/5 pr-2.5 pl-1.5">
              <span class="rounded-sm bg-failure-bg px-1 font-mono text-xxs font-medium text-failure-ink">
                PDF
              </span>
              {document.name}
              <span class="text-ink-extra-muted">
                {t('contracts.pageCount', { count: document.pageCount })}
              </span>
            </span>
          )}
        </For>
      </Row>

      <Row label={t('contracts.columnSigners')}>
        <For each={props.packet.recipients}>
          {(recipient, index) => (
            <span
              class="inline-flex h-7 items-center gap-2 rounded-full bg-ink/5 pr-2.5 pl-1"
              style={toneVars(recipientTone(props.packet, recipient.id))}
            >
              <Avatar size="sm">
                <Avatar.Fallback class="bg-(--tone) text-page">
                  {initialsOf(recipient.name)}
                </Avatar.Fallback>
              </Avatar>
              {recipient.isSender ? t('contracts.youLabel') : recipient.name}
              <span class="text-ink-extra-muted">
                <Show
                  when={recipient.role === 'signer'}
                  fallback={t('contracts.reviewGetsCopy')}
                >
                  {props.packet.signingOrder === 'sequential'
                    ? t('contracts.reviewSignsInOrder', {
                        position: index() + 1,
                      })
                    : t('contracts.reviewSigns')}
                </Show>
              </span>
            </span>
          )}
        </For>
      </Row>

      <Row label={t('contracts.livesIn')}>
        <For each={props.databases}>
          {(database) => (
            <span
              class="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/5 px-2"
              style={toneVars(database.color)}
            >
              <span class="size-2 rounded-full bg-(--tone)" />
              {database.name}
            </span>
          )}
        </For>
        <Show when={props.packet.company}>
          {(company) => (
            <span class="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/5 px-2">
              <BuildingsIcon class="size-3 text-ink-muted" />
              {company()}
            </span>
          )}
        </Show>
      </Row>

      <Row label={t('contracts.fields')}>
        <span class="flex-1">
          {t('contracts.fieldCount', { count: props.packet.fields.length })}
          <span class="text-ink-extra-muted">
            {' · '}
            {signers(props.packet)
              .map((signer) =>
                t('contracts.fieldsForSigner', {
                  count: fieldsFor(props.packet, signer.id).length,
                  name: signer.isSender
                    ? t('contracts.youInSentence')
                    : signer.name,
                })
              )
              .join(', ')}
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => props.onEdit()}>
          {t('contracts.reviewPlacement')}
        </Button>
      </Row>

      <Show when={props.warnings.length > 0}>
        <ul class="flex flex-col gap-1.5 border-t border-edge-muted py-2.5">
          <For each={props.warnings}>
            {(warning) => (
              <li class="flex gap-2 text-sm text-ink-muted">
                <WarningIcon class="mt-0.5 size-4 shrink-0 text-warning" />
                {warning}
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="flex flex-wrap items-center gap-2 border-t border-edge-muted pt-3">
        <span class="min-w-48 flex-1 text-xs text-ink-extra-muted">
          {t('contracts.reviewExpires', {
            count: props.packet.expirationDays,
          })}
          {' · '}
          {props.packet.reminderDays === null
            ? t('contracts.reviewNoReminders')
            : t('contracts.reviewReminds', {
                count: props.packet.reminderDays,
              })}
        </span>
        <Button variant="secondary" size="sm" onClick={() => props.onEdit()}>
          {t('contracts.edit')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={props.blocked}
          loading={props.sending}
          onClick={() => props.onSend()}
        >
          <PaperPlaneIcon class="size-3.5" />
          <Show
            when={
              firstSigner() && !firstSigner()?.isSender
                ? firstSigner()
                : undefined
            }
            fallback={t('contracts.send')}
          >
            {(signer) =>
              t('contracts.sendTo', { name: signer().name.split(' ')[0] })
            }
          </Show>
        </Button>
      </div>
    </article>
  );
}
