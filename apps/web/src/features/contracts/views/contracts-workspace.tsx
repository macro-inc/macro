import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { ListHeader } from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import SignatureIcon from '@icon/system/regular/signature.svg';
import { Button } from '@ui';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import {
  type ContractsScope,
  ContractsSidebar,
  packetFilterLabel,
} from '../components/contracts-sidebar';
import { PacketTable } from '../components/packet-table';
import { useContractsContext } from '../context/contracts-context';
import type { Packet } from '../core/packet';
import { allRows, databaseRows, matchesFilter } from '../core/packet-row';
import { CertificateDialog } from './certificate-dialog';
import { NewDatabaseDialog } from './new-database-dialog';
import { NewPacketDialog } from './new-packet-dialog';
import { PacketPane } from './packet-pane';
import { PlaceFields } from './place-fields';
import { ReviewDialog } from './review-dialog';
import { DocumentDialog } from './shared/document-dialog';

type Overlay =
  | { t: 'new-packet' }
  | { t: 'new-database' }
  | { t: 'review'; packetId: string }
  | { t: 'certificate'; packetId: string }
  | { t: 'document'; packetId: string; documentId: string };

/**
 * The Contracts module on desktop: databases of packets on the left, the
 * selected database as a table, and the packet drawer beside it.
 */
export function ContractsWorkspace() {
  const context = useContractsContext();
  const [scope, setScope] = createSignal<ContractsScope>({
    t: 'database',
    databaseId: context.databases()[0]?.id ?? '',
  });
  const [selectedId, setSelectedId] = createSignal<string>();
  const [placingId, setPlacingId] = createSignal<string>();
  const [overlay, setOverlay] = createSignal<Overlay>();

  const packet = (packetId: string | undefined): Packet | undefined =>
    context.packets().find((each) => each.id === packetId);
  const database = () => {
    const current = scope();
    if (current.t !== 'database') return undefined;
    return context.databases().find((each) => each.id === current.databaseId);
  };

  const rows = createMemo(() => {
    const current = scope();
    if (current.t === 'database') {
      return databaseRows(context.packets(), current.databaseId, context.now());
    }
    return allRows(context.packets(), context.now()).filter((row) =>
      matchesFilter(row, current.filter)
    );
  });
  const selected = () =>
    allRows(context.packets(), context.now()).find(
      (row) => row.packet.id === selectedId()
    );

  const title = () => {
    const current = scope();
    if (current.t === 'filter') return packetFilterLabel(current.filter);
    return database()?.name ?? t('nav.contracts');
  };
  const reviewing = () => {
    const current = overlay();
    return current?.t === 'review' ? packet(current.packetId) : undefined;
  };
  const certified = () => {
    const current = overlay();
    return current?.t === 'certificate' ? packet(current.packetId) : undefined;
  };
  const viewing = () => {
    const current = overlay();
    if (current?.t !== 'document') return undefined;
    const opened = packet(current.packetId);
    return opened
      ? { packet: opened, documentId: current.documentId }
      : undefined;
  };
  /** New packets start in the open database, or the first one. */
  const homeDatabaseId = () =>
    database()?.id ?? context.databases()[0]?.id ?? '';

  /** Set by the open placement view: saves it, and says whether it did. */
  let savePlacement: (() => Promise<boolean>) | undefined;

  /**
   * Another list: close the drawer and leave placement, once its fields are
   * saved. If they cannot be saved the editor stays open with the work in it.
   */
  async function changeScope(next: ContractsScope) {
    if (savePlacement && !(await savePlacement())) return;
    setScope(next);
    setPlacingId(undefined);
    setSelectedId(undefined);
  }
  const goTo = (next: ContractsScope) =>
    fireAndForget(changeScope(next), 'contracts.scope');

  return (
    <>
      <ViewShell.Root
        class="h-full min-h-0"
        asidePreferenceKey="contracts"
        resizable
        aside={{ preserveDuringResize: false }}
        detail={{ width: 560, min: 420, max: 900, whenNarrow: 'replace' }}
        detailOpen={!!selected() && !placingId()}
      >
        <ViewShell.Aside>
          <ContractsSidebar
            scope={scope()}
            databases={context.databases()}
            onScope={goTo}
            onNewPacket={() => setOverlay({ t: 'new-packet' })}
            onNewDatabase={() => setOverlay({ t: 'new-database' })}
          />
        </ViewShell.Aside>

        <ViewShell.Main>
          <Switch>
            {/* Keyed on the id: each packet gets its own placement, and the
                view stays mounted while its packet changes underneath it. */}
            <Match when={packet(placingId())?.id} keyed>
              {(id) => (
                <Show when={packet(id)}>
                  {(placing) => (
                    <PlaceFields
                      packet={placing()}
                      onBack={() => {
                        setSelectedId(id);
                        setPlacingId(undefined);
                      }}
                      onReview={() => setOverlay({ t: 'review', packetId: id })}
                      onSaver={(save) => {
                        savePlacement = save;
                      }}
                    />
                  )}
                </Show>
              )}
            </Match>
            <Match when={true}>
              <ListHeader
                title={
                  <ViewSidebar.Title caret={false}>{title()}</ViewSidebar.Title>
                }
              >
                <ViewCreateButton
                  aria-label={t('contracts.newPacket')}
                  onClick={() => setOverlay({ t: 'new-packet' })}
                />
              </ListHeader>
              <ViewShell.Content>
                <div class="flex h-full flex-col gap-3 overflow-auto px-4 pb-4">
                  <p class="shrink-0 rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink-muted">
                    {t('contracts.localBanner')}
                  </p>
                  <Show when={context.loadFailed()}>
                    <p
                      role="alert"
                      class="shrink-0 rounded-lg bg-failure-bg px-3 py-2 text-sm text-failure-ink"
                    >
                      {t('contracts.loadFailed')}
                    </p>
                  </Show>
                  <Show
                    when={rows().length > 0}
                    fallback={
                      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                        <SignatureIcon class="size-6 text-ink-extra-muted" />
                        <h2 class="text-sm font-semibold">
                          {t('contracts.emptyTitle')}
                        </h2>
                        <p class="max-w-sm text-sm text-ink-muted">
                          {t('contracts.emptyBody')}
                        </p>
                        <Button
                          variant="primary"
                          onClick={() => setOverlay({ t: 'new-packet' })}
                        >
                          {t('contracts.newPacket')}
                        </Button>
                      </div>
                    }
                  >
                    <PacketTable
                      rows={rows()}
                      selectedId={selectedId()}
                      onOpen={setSelectedId}
                      onCreate={() => setOverlay({ t: 'new-packet' })}
                    />
                  </Show>
                </div>
              </ViewShell.Content>
            </Match>
          </Switch>
        </ViewShell.Main>

        <ViewShell.Detail class="border-l border-edge-muted">
          {/* Keyed on the id, not the row: the pane stays mounted while its
              packet changes underneath it. */}
          <Show when={selectedId()} keyed>
            {(_id) => (
              <Show when={selected()}>
                {(row) => (
                  <PacketPane
                    row={row()}
                    onClose={() => setSelectedId(undefined)}
                    onPlaceFields={setPlacingId}
                    onCertificate={(packetId) =>
                      setOverlay({ t: 'certificate', packetId })
                    }
                    onOpenDocument={(opened, documentId) =>
                      setOverlay({
                        t: 'document',
                        packetId: opened.id,
                        documentId,
                      })
                    }
                  />
                )}
              </Show>
            )}
          </Show>
        </ViewShell.Detail>
      </ViewShell.Root>

      <Switch>
        <Match when={overlay()?.t === 'new-packet'}>
          <NewPacketDialog
            databaseId={homeDatabaseId()}
            onClose={() => setOverlay(undefined)}
            onCreated={(created) => {
              setOverlay(undefined);
              setPlacingId(created.id);
            }}
          />
        </Match>
        <Match when={overlay()?.t === 'new-database'}>
          <NewDatabaseDialog
            onClose={() => setOverlay(undefined)}
            onCreated={(created) => {
              setOverlay(undefined);
              goTo({ t: 'database', databaseId: created.id });
            }}
          />
        </Match>
        <Match when={reviewing()}>
          {(draft) => (
            <ReviewDialog
              packet={draft()}
              onEdit={() => setOverlay(undefined)}
              onClose={() => setOverlay(undefined)}
              onSent={(sent) => {
                setOverlay(undefined);
                setPlacingId(undefined);
                setSelectedId(sent.id);
              }}
            />
          )}
        </Match>
        <Match when={certified()}>
          {(signed) => (
            <CertificateDialog
              packet={signed()}
              onClose={() => setOverlay(undefined)}
            />
          )}
        </Match>
        <Match when={viewing()}>
          {(opened) => (
            <DocumentDialog
              packet={opened().packet}
              documentId={opened().documentId}
              onClose={() => setOverlay(undefined)}
            />
          )}
        </Match>
      </Switch>
    </>
  );
}
