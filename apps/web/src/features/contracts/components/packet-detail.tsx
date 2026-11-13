import { t } from '@app/lib/i18n';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Avatar, Button } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { PdfDocument } from '../context/contracts-context';
import type { CertificateEvent, MergedHistory } from '../core/certificate';
import type { ContractDatabase } from '../core/database';
import type { Packet, PacketDocument, Recipient } from '../core/packet';
import { signingPosition } from '../core/routing';
import { describeEvent } from './activity';
import {
  formatDateTime,
  formatDay,
  formatDayWithYear,
  initialsOf,
} from './format';
import { PdfPage } from './pdf-page';
import { recipientTone, toneVars } from './tone';

export function SectionHeading(props: {
  children: JSX.Element;
  aside?: JSX.Element;
}) {
  return (
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-xs font-medium text-ink-extra-muted">{props.children}</h3>
      <Show when={props.aside}>
        <span class="text-xs text-ink-extra-muted">{props.aside}</span>
      </Show>
    </div>
  );
}

/** A document's first page with its name and size underneath. */
export function DocumentThumbnail(props: {
  document: PacketDocument;
  pdf: PdfDocument | undefined;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      class="flex w-36 flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
      aria-pressed={props.selected}
      onClick={() => props.onOpen()}
    >
      <span
        class="block h-32 overflow-hidden rounded-md bg-[#ffffff] shadow-md"
        classList={{ 'ring-2 ring-accent': props.selected }}
      >
        <Show when={props.pdf}>
          {(pdf) => (
            <PdfPage pdf={pdf()} page={0} label={props.document.name} />
          )}
        </Show>
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-sm font-medium text-ink">
          {props.document.name}
        </span>
        <span class="truncate text-xs text-ink-extra-muted">
          <Show
            when={props.document.convertedFrom}
            fallback={t('contracts.documentPagesPdf', {
              count: props.document.pageCount,
            })}
          >
            {t('contracts.documentPagesFromDocx', {
              count: props.document.pageCount,
            })}
          </Show>
        </span>
      </span>
    </button>
  );
}

function recipientState(packet: Packet, recipient: Recipient): string {
  if (recipient.role === 'copy') return t('contracts.roleCopy');
  if (recipient.declinedAt) return t('contracts.recipientDeclined');
  // A packet closed by hand was signed on paper, not through a link.
  if (packet.statusOverride?.tag === 'offline') {
    return t('contracts.recipientSignedOffline');
  }
  if (recipient.viewedAt) return t('contracts.recipientViewed');
  if (recipient.access) return t('contracts.recipientInvited');
  return t('contracts.recipientWaiting');
}

/** Each recipient's place in the signing order and how far they have got. */
export function RecipientList(props: {
  packet: Packet;
  /** The packet still accepts signatures. */
  inFlight: boolean;
  onSign: (recipient: Recipient) => void;
  onCopyLink: (recipient: Recipient) => void;
}) {
  return (
    <ul class="overflow-hidden rounded-xl border border-edge-muted">
      <For each={props.packet.recipients}>
        {(recipient) => (
          <li
            class="flex min-h-13 items-center gap-2.5 border-b border-edge-muted/60 px-3 last:border-b-0"
            classList={{
              'bg-accent-bg':
                props.inFlight && recipient.isSender && !!recipient.access,
            }}
            style={toneVars(recipientTone(props.packet, recipient.id))}
          >
            <span class="w-5 shrink-0 text-center text-xs tabular-nums text-ink-extra-muted">
              <Show
                when={signingPosition(props.packet, recipient.id)}
                fallback={t('contracts.copyAbbreviation')}
              >
                {(position) => position()}
              </Show>
            </span>
            <Avatar size="md">
              <Avatar.Fallback class="bg-(--tone) text-page">
                {initialsOf(recipient.name)}
              </Avatar.Fallback>
            </Avatar>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium text-ink">
                {recipient.name}
                <Show when={recipient.isSender}>
                  <span class="font-normal text-ink-extra-muted">
                    {' '}
                    {t('contracts.you')}
                  </span>
                </Show>
              </span>
              <span class="truncate text-xs text-ink-extra-muted">
                {recipient.signedAt
                  ? recipient.email
                  : recipientState(props.packet, recipient)}
              </span>
            </span>
            <Switch>
              <Match when={recipient.signedAt}>
                {(signedAt) => (
                  <span class="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success-ink">
                    <CheckIcon class="size-3.5" />
                    {t('contracts.recipientSigned', {
                      date: formatDay(signedAt()),
                    })}
                  </span>
                )}
              </Match>
              <Match when={recipient.role === 'copy'}>
                <span class="shrink-0 text-xs text-ink-extra-muted">
                  {t('contracts.recipientGetsCopy')}
                </span>
              </Match>
              <Match
                when={props.inFlight && recipient.isSender && recipient.access}
              >
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => props.onSign(recipient)}
                >
                  {t('contracts.signNow')}
                </Button>
              </Match>
              <Match when={props.inFlight && recipient.access}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => props.onCopyLink(recipient)}
                >
                  {t('contracts.copySigningLink')}
                </Button>
              </Match>
            </Switch>
          </li>
        )}
      </For>
    </ul>
  );
}

function PropertyRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-8 items-center gap-2">
      <span class="w-(--sidepanel-label-width) shrink-0 text-sm text-ink-extra-muted">
        {props.label}
      </span>
      <span class="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
        {props.children}
      </span>
    </div>
  );
}

/** Where the packet lives and how its signing window is set. */
export function PacketProperties(props: {
  packet: Packet;
  databases: readonly ContractDatabase[];
  nextReminderAt: string | undefined;
}) {
  return (
    <div class="flex flex-col">
      <PropertyRow label={t('contracts.databases')}>
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
      </PropertyRow>
      <Show when={props.packet.company}>
        {(company) => (
          <PropertyRow label={t('contracts.columnCompany')}>
            <span class="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/5 px-2">
              <BuildingsIcon class="size-3 text-ink-muted" />
              {company()}
            </span>
          </PropertyRow>
        )}
      </Show>
      <PropertyRow label={t('contracts.columnExpires')}>
        <Show
          when={props.packet.expiresAt}
          fallback={
            <span class="text-ink-extra-muted">
              {t('contracts.expiresAfterSending', {
                count: props.packet.expirationDays,
              })}
            </span>
          }
        >
          {(expiresAt) => (
            <>
              {formatDayWithYear(expiresAt())}
              <span class="text-ink-extra-muted">
                {t('contracts.expirationWindow', {
                  count: props.packet.expirationDays,
                })}
              </span>
            </>
          )}
        </Show>
      </PropertyRow>
      <PropertyRow label={t('contracts.reminders')}>
        <Show
          when={props.packet.reminderDays}
          fallback={
            <span class="text-ink-extra-muted">
              {t('contracts.remindersOff')}
            </span>
          }
        >
          {(days) => (
            <>
              {t('contracts.reminderCadence', { count: days() })}
              <Show when={props.nextReminderAt}>
                {(next) => (
                  <span class="text-ink-extra-muted">
                    {t('contracts.nextReminder', { date: formatDay(next()) })}
                  </span>
                )}
              </Show>
            </>
          )}
        </Show>
      </PropertyRow>
    </div>
  );
}

/** The packet's log, newest first. */
/** The log a merged-in packet had, kept under the packet it became part of. */
export function MergedHistoryList(props: { histories: MergedHistory[] }) {
  return (
    <For each={props.histories}>
      {(history) => (
        <section class="flex flex-col gap-2">
          <SectionHeading>
            {t('contracts.mergedHistory', { title: history.title })}
          </SectionHeading>
          <ActivityList events={history.events} />
        </section>
      )}
    </For>
  );
}

export function ActivityList(props: { events: CertificateEvent[] }) {
  return (
    <ol class="flex flex-col gap-2">
      <For each={[...props.events].reverse()}>
        {(event) => (
          <li class="flex items-baseline gap-2.5 text-sm">
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 -translate-y-0.5 rounded-full"
              classList={{
                'bg-success':
                  event.type === 'contract.signed_by_recipient' ||
                  event.type === 'contract.completed',
                'bg-accent': event.type === 'contract.sent',
                'bg-failure':
                  event.type === 'contract.declined' ||
                  event.type === 'contract.voided',
                'bg-ink-placeholder':
                  event.type !== 'contract.signed_by_recipient' &&
                  event.type !== 'contract.completed' &&
                  event.type !== 'contract.sent' &&
                  event.type !== 'contract.declined' &&
                  event.type !== 'contract.voided',
              }}
            />
            <span class="min-w-0 flex-1 text-ink-muted">
              {describeEvent(event)}
            </span>
            <span class="shrink-0 text-xs tabular-nums text-ink-extra-muted">
              {formatDateTime(event.at)}
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}
