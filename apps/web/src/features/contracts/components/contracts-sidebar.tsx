import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SignatureIcon from '@icon/system/regular/signature.svg';
import { type Component, createSignal, For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { ContractDatabase } from '../core/database';
import { PACKET_FILTERS, type PacketFilter } from '../core/packet-row';
import { toneVars } from './tone';

/** What the workspace lists: a cross-database filter or one database. */
export type ContractsScope =
  | { t: 'filter'; filter: PacketFilter }
  | { t: 'database'; databaseId: string };

export function packetFilterLabel(filter: PacketFilter): string {
  return match(filter)
    .with('all', () => t('contracts.filterAll'))
    .with('in_flight', () => t('contracts.filterInFlight'))
    .with('needs_my_signature', () => t('contracts.filterNeedsMySignature'))
    .with('completed', () => t('contracts.filterCompleted'))
    .exhaustive();
}

function filterIcon(filter: PacketFilter): Component<{ class?: string }> {
  return match(filter)
    .with('all', () => SignatureIcon)
    .with('in_flight', () => PaperPlaneIcon)
    .with('needs_my_signature', () => PencilIcon)
    .with('completed', () => CheckCircleIcon)
    .exhaustive();
}

/** The Contracts module's local navigation: packet filters, then databases. */
export function ContractsSidebar(props: {
  scope: ContractsScope;
  databases: readonly ContractDatabase[];
  onScope: (scope: ContractsScope) => void;
  onNewPacket: () => void;
  onNewDatabase: () => void;
}) {
  const [packetsOpen, setPacketsOpen] = createSignal(true);
  const [databasesOpen, setDatabasesOpen] = createSignal(true);

  return (
    <ViewSidebar.Root aria-label={t('contracts.navigation')}>
      <header class="flex shrink-0 flex-col">
        <ViewSidebar.Header>
          <ViewSidebar.Title>{t('nav.contracts')}</ViewSidebar.Title>
        </ViewSidebar.Header>
        <ViewSidebar.Primary>
          <ViewCreateButton
            presentation="sidebar"
            aria-label={t('contracts.newPacket')}
            onClick={() => props.onNewPacket()}
          />
        </ViewSidebar.Primary>
      </header>

      <ViewSidebar.Content>
        <CollapsibleSection.Root
          open={packetsOpen()}
          onOpenChange={setPacketsOpen}
        >
          <CollapsibleSection.Trigger>
            <span>{t('contracts.packets')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('contracts.packets')}>
              <For each={PACKET_FILTERS}>
                {(filter) => (
                  <ViewSidebar.Item
                    active={
                      props.scope.t === 'filter' &&
                      props.scope.filter === filter
                    }
                    onClick={() => props.onScope({ t: 'filter', filter })}
                  >
                    <ViewSidebar.Icon>
                      <Dynamic component={filterIcon(filter)} class="size-4" />
                    </ViewSidebar.Icon>
                    <span class="truncate">{packetFilterLabel(filter)}</span>
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>

        <CollapsibleSection.Root
          open={databasesOpen()}
          onOpenChange={setDatabasesOpen}
        >
          <CollapsibleSection.Trigger>
            <span>{t('contracts.databases')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label={t('contracts.databases')}>
              <For each={props.databases}>
                {(database) => (
                  <ViewSidebar.Item
                    active={
                      props.scope.t === 'database' &&
                      props.scope.databaseId === database.id
                    }
                    onClick={() =>
                      props.onScope({ t: 'database', databaseId: database.id })
                    }
                  >
                    <ViewSidebar.Icon>
                      <span
                        class="flex text-(--tone)"
                        style={toneVars(database.color)}
                      >
                        <DatabaseIcon class="size-4" />
                      </span>
                    </ViewSidebar.Icon>
                    <span class="truncate">{database.name}</span>
                  </ViewSidebar.Item>
                )}
              </For>
              <ViewSidebar.Item onClick={() => props.onNewDatabase()}>
                <ViewSidebar.Icon>
                  <PlusIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="truncate text-ink-extra-muted">
                  {t('contracts.newDatabase')}
                </span>
              </ViewSidebar.Item>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
