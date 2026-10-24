import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { useSearchParams } from '@solidjs/router';
import { z } from 'zod';
import { WhatsAppLinked } from '../whatsapp-linked/whatsapp-linked';

/**
 * External: accounts on outside messaging apps that bring conversations into
 * Macro. WhatsApp is the only one today, so the list has one entry.
 */
export function ExternalView() {
  useSplitDisplayName(() => 'External');
  // Read once: the pairing id is consumed, then dropped from the URL.
  const [search, setSearch] = useSearchParams();
  const handedOffPairing = z.uuid().safeParse(search.whatsappPairing).data;
  if (search.whatsappPairing !== undefined)
    setSearch({ whatsappPairing: undefined }, { replace: true });
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          asidePreferenceKey="external"
          aside={isTouchDevice() ? false : undefined}
          resizable={!isTouchDevice()}
        >
          <ViewShell.Aside>
            <ViewSidebar.Root aria-label="External navigation">
              <ViewSidebar.Header>
                <div class="flex min-w-0 items-center gap-1">
                  <ViewSidebar.CloseButton class="shrink-0" />
                  <ViewSidebar.Title>External</ViewSidebar.Title>
                </div>
              </ViewSidebar.Header>
              <ViewSidebar.Content>
                <ViewSidebar.Nav aria-label="External apps">
                  <ViewSidebar.Item active aria-current="page" title="WhatsApp">
                    <ViewSidebar.Icon>
                      <WhatsappIcon class="size-4" />
                    </ViewSidebar.Icon>
                    <span class="truncate">WhatsApp</span>
                  </ViewSidebar.Item>
                </ViewSidebar.Nav>
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <ViewShell.TopBar>
              <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.03em] text-ink">
                WhatsApp
              </h1>
            </ViewShell.TopBar>
            <ViewShell.Content class="overflow-y-auto px-4 py-4 mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
              {/* The top bar is desktop chrome; touch layouts title the page here. */}
              <h1 class="hidden px-1 pb-3 text-lg font-semibold text-ink touch:block">
                WhatsApp
              </h1>
              <WhatsAppLinked resumePairingId={handedOffPairing} />
            </ViewShell.Content>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
