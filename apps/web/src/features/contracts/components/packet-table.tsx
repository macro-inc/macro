import { t } from '@app/lib/i18n';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import LinkIcon from '@icon/system/regular/link-simple.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SignatureIcon from '@icon/system/regular/signature.svg';
import UserIcon from '@icon/system/regular/user.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Key } from '@solid-primitives/keyed';
import { Avatar, Button } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import type { PacketRow } from '../core/packet-row';
import { formatDay, initialsOf } from './format';
import { PacketStatusPill } from './packet-status-pill';
import { SignerProgress } from './signer-progress';

function HeaderCell(props: {
  icon: Component<{ class?: string }>;
  children: JSX.Element;
}) {
  return (
    <div
      role="columnheader"
      class="flex min-w-0 items-center gap-2 border-l border-edge-muted/40 px-3 text-xs font-medium text-ink-muted"
    >
      <props.icon class="size-3.5 shrink-0" />
      <span class="truncate">{props.children}</span>
    </div>
  );
}

function Cell(props: { children: JSX.Element }) {
  return (
    <div
      role="cell"
      class="flex min-w-0 items-center border-l border-edge-muted/40 px-3"
    >
      {props.children}
    </div>
  );
}

/** The interactive primary cell of a packet's row. */
function PacketBlock(props: {
  row: PacketRow;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      class="min-w-0 max-w-full"
      aria-pressed={props.selected}
      onClick={() => props.onOpen()}
    >
      <SignatureIcon class="size-3.5 shrink-0 text-ink-muted" />
      <span class="truncate text-ink">{props.row.packet.title}</span>
      <span class="shrink-0 text-xs font-normal text-ink-extra-muted">
        {t('contracts.documentCount', {
          count: props.row.packet.documents.length,
        })}
      </span>
    </Button>
  );
}

/**
 * A Contracts database as a table: one row per packet, led by its Packet
 * Block and its system-managed status.
 */
export function PacketTable(props: {
  rows: PacketRow[];
  selectedId?: string;
  onOpen: (packetId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div class="min-w-[58rem] overflow-hidden rounded-xl border border-edge-muted">
      <div
        role="table"
        aria-label={t('contracts.packets')}
        class="[--packet-columns:2.75rem_minmax(15rem,1.4fr)_11rem_8.5rem_minmax(10rem,1fr)_10.5rem_6rem]"
      >
        <div
          role="row"
          class="grid min-h-10 grid-cols-(--packet-columns) border-b border-edge-muted"
        >
          <div
            role="columnheader"
            class="flex items-center justify-center text-xxs text-ink-placeholder"
          >
            #
          </div>
          <HeaderCell icon={SignatureIcon}>
            {t('contracts.columnPacket')}
          </HeaderCell>
          <HeaderCell icon={ListIcon}>{t('contracts.columnStatus')}</HeaderCell>
          <HeaderCell icon={UsersIcon}>
            {t('contracts.columnSigners')}
          </HeaderCell>
          <HeaderCell icon={LinkIcon}>
            {t('contracts.columnCompany')}
          </HeaderCell>
          <HeaderCell icon={UserIcon}>{t('contracts.columnOwner')}</HeaderCell>
          <HeaderCell icon={CalendarIcon}>
            {t('contracts.columnExpires')}
          </HeaderCell>
        </div>

        {/* Keyed on the packet's id: a row survives its packet being
            replaced by a newer copy, so focus and hover stay put. */}
        <Key each={props.rows} by={(row) => row.packet.id}>
          {(row, index) => (
            <div
              role="row"
              aria-selected={props.selectedId === row().packet.id}
              class="grid min-h-[47px] grid-cols-(--packet-columns) border-b border-edge-muted/60"
              classList={{
                'bg-list-selected shadow-[inset_2px_0_0_var(--color-accent)]':
                  props.selectedId === row().packet.id,
                'not-touch:hover:bg-hover/50':
                  props.selectedId !== row().packet.id,
              }}
            >
              <div
                role="cell"
                class="flex items-center justify-center text-xxs tabular-nums text-ink-placeholder"
              >
                {index() + 1}
              </div>
              <Cell>
                <PacketBlock
                  row={row()}
                  selected={props.selectedId === row().packet.id}
                  onOpen={() => props.onOpen(row().packet.id)}
                />
              </Cell>
              <Cell>
                <PacketStatusPill
                  status={row().status}
                  offline={row().packet.statusOverride?.tag === 'offline'}
                />
              </Cell>
              <Cell>
                <SignerProgress
                  status={row().status}
                  progress={row().progress}
                />
              </Cell>
              <Cell>
                <Show when={row().packet.company}>
                  {(company) => (
                    <span class="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-ink/5 px-2.5 text-sm">
                      <BuildingsIcon class="size-3.5 shrink-0 text-ink-muted" />
                      <span class="truncate">{company()}</span>
                    </span>
                  )}
                </Show>
              </Cell>
              <Cell>
                <span class="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
                  <Avatar size="sm">
                    <Avatar.Fallback>
                      {initialsOf(row().packet.owner.name)}
                    </Avatar.Fallback>
                  </Avatar>
                  <span class="truncate">{row().packet.owner.name}</span>
                </span>
              </Cell>
              <Cell>
                <Show
                  when={row().packet.expiresAt}
                  fallback={
                    <span class="text-sm text-ink-placeholder">
                      {t('contracts.noExpiry')}
                    </span>
                  }
                >
                  {(expiresAt) => (
                    <span
                      class="whitespace-nowrap text-sm"
                      classList={{
                        'text-orange-ink': row().status === 'expired',
                        'text-ink-muted': row().status !== 'expired',
                      }}
                    >
                      {formatDay(expiresAt())}
                    </span>
                  )}
                </Show>
              </Cell>
            </div>
          )}
        </Key>
      </div>

      <Button
        variant="ghost"
        size="lg"
        fullWidth
        class="justify-start rounded-none"
        onClick={() => props.onCreate()}
      >
        <PlusIcon class="size-3.5" />
        {t('contracts.newPacket')}
      </Button>
    </div>
  );
}
