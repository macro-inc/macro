import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
import { externalRoute, externalWhatsappGroupRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { queryReadyGate } from '@queries/gate';
import { useWhatsappGroupsQuery } from '@queries/whatsapp-groups';
import { useWhatsappGroupListsSync } from '@queries/whatsapp-groups/sync';
import { traceWhatsappLoad } from '@queries/whatsapp-linked/operation';
import { useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { z } from 'zod';
import { whatsappGroupApi } from '../whatsapp-group/queries/production-api';
import { WhatsAppLinked } from '../whatsapp-linked/whatsapp-linked';
import { InMacroSection } from './components/in-macro-section';

/**
 * External: accounts on outside messaging apps that bring conversations into
 * Macro. WhatsApp is the only one today. Groups in Macro open in the main pane
 * at `/external/whatsapp/:groupId`; on touch the list drills into the group.
 */
export function ExternalView() {
  useSplitDisplayName(() => 'External');
  // Read once: the pairing id is consumed, then dropped from the URL.
  const [search, setSearch] = useSearchParams();
  const handedOffPairing = z.uuid().safeParse(search.whatsappPairing).data;
  if (search.whatsappPairing !== undefined)
    setSearch({ whatsappPairing: undefined }, { replace: true });

  useWhatsappGroupListsSync();
  const userId = useUserId();
  const groups = useWhatsappGroupsQuery(whatsappGroupApi, () => userId() ?? '');
  const inMacro = () => (queryReadyGate(groups) ? groups.data : undefined);
  traceWhatsappLoad('groups.load', () => {
    if (groups.isError) return { outcome: 'error' };
    const list = inMacro();
    if (!list) return;
    return {
      outcome: 'success',
      attrs: {
        'whatsapp.groups.count': list.length,
        'whatsapp.groups.unread': list.filter((group) => group.unreadCount)
          .length,
      },
    };
  });

  const params = useParams<{ groupId?: string }>();
  const navigate = useNavigate();
  const openGroup = (groupId: string) =>
    fireAndForget(
      navigate({ route: externalWhatsappGroupRoute, params: { groupId } }),
      'external-view'
    );
  const openWhatsApp = () =>
    fireAndForget(
      navigate({ route: externalRoute, params: {} }),
      'external-view'
    );
  const [inMacroOpen, setInMacroOpen] = createSignal(true);
  const inMacroSection = () => (
    <InMacroSection
      groups={inMacro()}
      isPending={groups.isPending}
      isError={groups.isError}
      activeGroupId={params.groupId}
      open={inMacroOpen()}
      onOpenChange={setInMacroOpen}
      onOpenGroup={openGroup}
      onRetry={() => fireAndForget(groups.refetch(), 'external-view')}
    />
  );

  const whatsappPage = () => (
    <>
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
        {/* Touch has no sidebar: the groups in Macro lead the page. */}
        <Show when={isTouchDevice()}>
          <div class="pb-4">{inMacroSection()}</div>
        </Show>
        <WhatsAppLinked resumePairingId={handedOffPairing} />
      </ViewShell.Content>
    </>
  );

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
                  <ViewSidebar.Item
                    active={!params.groupId}
                    title="WhatsApp"
                    onClick={openWhatsApp}
                  >
                    <ViewSidebar.Icon>
                      <WhatsappIcon class="size-4" />
                    </ViewSidebar.Icon>
                    <span class="truncate">WhatsApp</span>
                  </ViewSidebar.Item>
                </ViewSidebar.Nav>
                {inMacroSection()}
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <SplitRouter.Outlet fallback={whatsappPage} />
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
