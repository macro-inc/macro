import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { fireAndForget } from '@core/util/fireAndForget';
import { Dialog } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { PacketStatusPill } from '../../components/packet-status-pill';
import { SignerProgress } from '../../components/signer-progress';
import { useContractsContext } from '../../context/contracts-context';
import { allRows } from '../../core/packet-row';
import { createPacketActions } from '../shared/packet-actions';
import { PacketSummary } from '../shared/packet-summary';

/**
 * Contracts on a phone or tablet: every packet in one list, with its summary
 * in a sheet. Creating packets and placing fields are desk work.
 */
export function MobileContractsWorkspace() {
  const context = useContractsContext();
  const actions = createPacketActions(context);
  const [selectedId, setSelectedId] = createSignal<string>();
  const rows = createMemo(() => allRows(context.packets(), context.now()));
  const selected = () => rows().find((row) => row.packet.id === selectedId());

  return (
    <>
      <MobileHeader>
        <MobileHeader.Title label={t('nav.contracts')} />
      </MobileHeader>

      <div class="flex h-full flex-col gap-2 overflow-auto px-(--mobile-chrome-gutter) pt-(--mobile-content-inset-top) pb-(--mobile-content-inset-bottom)">
        <p class="rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink-muted">
          {t('contracts.localBanner')}
        </p>
        <Show
          when={rows().length > 0}
          fallback={
            <p class="p-6 text-center text-sm text-ink-muted">
              {t('contracts.mobileEmpty')}
            </p>
          }
        >
          <ul class="flex flex-col">
            <For each={rows()}>
              {(row) => (
                <li>
                  <button
                    type="button"
                    class="flex min-h-14 w-full flex-col justify-center gap-1 border-b border-edge-muted/60 py-2 text-left"
                    onClick={() => setSelectedId(row.packet.id)}
                  >
                    <span class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate font-medium">
                        {row.packet.title}
                      </span>
                      <PacketStatusPill
                        status={row.status}
                        offline={row.packet.statusOverride?.tag === 'offline'}
                      />
                    </span>
                    <SignerProgress
                      status={row.status}
                      progress={row.progress}
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <Show when={selectedId()} keyed>
        {(_id) => (
          <Show when={selected()}>
            {(row) => (
              <Dialog
                open
                onOpenChange={(open) => !open && setSelectedId(undefined)}
                position="center"
                class="p-4"
              >
                <Dialog.Title class="pb-3 text-base font-semibold">
                  {row().packet.title}
                </Dialog.Title>
                <PacketSummary
                  row={row()}
                  onOpenDocument={() => {}}
                  onSign={actions.openSigning}
                  onCopyLink={(recipient) =>
                    fireAndForget(
                      actions.copySigningLink(recipient),
                      'contracts.copy-link'
                    )
                  }
                />
              </Dialog>
            )}
          </Show>
        )}
      </Show>
    </>
  );
}
