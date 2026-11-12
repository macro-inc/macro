import { ViewShell } from '@app/components/view-shell';
import { TutorialSidebarItem } from '@app/features/video-tutorials';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { useSearchParams } from '@solidjs/router';
import type { Component, JSX } from 'solid-js';
import { z } from 'zod';
import { WhatsAppLinked } from '../whatsapp-linked/whatsapp-linked';

export type ProviderPageProps = {
  /** The chats in Macro, on touch where there is no sidebar; else nothing. */
  inMacro: JSX.Element;
};

function ProviderHeading(props: { label: string }) {
  return (
    <>
      <ViewShell.TopBar>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.03em] text-ink">
          {props.label}
        </h1>
      </ViewShell.TopBar>
      <ViewShell.Header class="hidden touch:block touch:pb-2">
        <h1 class="text-lg font-semibold text-ink">{props.label}</h1>
      </ViewShell.Header>
    </>
  );
}

function WhatsAppPage(props: ProviderPageProps) {
  // Read once: the pairing id is consumed, then dropped from the URL.
  const [search, setSearch] = useSearchParams();
  const handedOffPairing = z.uuid().safeParse(search.whatsappPairing).data;
  if (search.whatsappPairing !== undefined)
    setSearch({ whatsappPairing: undefined }, { replace: true });
  return (
    <>
      <ProviderHeading label="WhatsApp" />
      <ViewShell.Content
        class="overflow-y-auto pb-4 touch:pb-(--mobile-content-inset-bottom)"
        style={{ '--mobile-content-inset-top': '0px' }}
      >
        {/* Above the chats, so people who haven't linked WhatsApp see it too.
            Its rows are sidebar-style items, so the entry is one, inset to
            line up with the chats below it. Touch devices show no tutorial. */}
        <div class="px-4 pt-2 empty:hidden">
          <TutorialSidebarItem tutorial="whatsapp" />
        </div>
        {props.inMacro}
        <WhatsAppLinked resumePairingId={handedOffPairing} />
      </ViewShell.Content>
    </>
  );
}

/** Each provider's account page in External's main pane. */
export const PROVIDER_PAGES: Record<
  ExternalChatProvider,
  Component<ProviderPageProps>
> = {
  whatsapp: WhatsAppPage,
};
