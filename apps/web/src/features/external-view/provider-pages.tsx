import { ViewShell } from '@app/components/view-shell';
import { TutorialSidebarItem } from '@app/features/video-tutorials';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { useSearchParams } from '@solidjs/router';
import type { Component, JSX } from 'solid-js';
import { z } from 'zod';
import type { SlackHandoff } from '../slack-linked/primitives/slack-page';
import { SlackLinked } from '../slack-linked/slack-linked';
import { WhatsAppLinked } from '../whatsapp-linked/whatsapp-linked';

export type ProviderPageProps = {
  /** On touch, where the top bar floats: External's title and provider switcher. */
  heading: JSX.Element;
  /** The chats in Macro, on touch where there is no sidebar; else nothing. */
  inMacro: JSX.Element;
};

function ProviderHeading(props: { label: string; heading: JSX.Element }) {
  return (
    <>
      <ViewShell.TopBar>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.03em] text-ink">
          {props.label}
        </h1>
      </ViewShell.TopBar>
      {props.heading}
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
      <ProviderHeading label="WhatsApp" heading={props.heading} />
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

/** `?slackLogin=<attempt id>` resumes a sign-in; `browser` opens Slack's own. */
function slackHandoff(value: unknown): SlackHandoff | undefined {
  if (value === 'browser') return { kind: 'browser' };
  const loginId = z.uuid().safeParse(value).data;
  return loginId ? { kind: 'login', loginId } : undefined;
}

function SlackPage(props: ProviderPageProps) {
  // Read once: the handoff is consumed, then dropped from the URL.
  const [search, setSearch] = useSearchParams();
  const handoff = slackHandoff(search.slackLogin);
  if (search.slackLogin !== undefined)
    setSearch({ slackLogin: undefined }, { replace: true });
  return (
    <>
      <ProviderHeading label="Slack" heading={props.heading} />
      <ViewShell.Content
        class="overflow-y-auto pb-4 touch:pb-(--mobile-content-inset-bottom)"
        style={{ '--mobile-content-inset-top': '0px' }}
      >
        {props.inMacro}
        <SlackLinked handoff={handoff} />
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
  slack: SlackPage,
};

/**
 * The search param that hands a provider's page a step begun elsewhere (a
 * desktop deep link, a pairing on another device). External opens on that
 * provider's page when it carries one.
 */
const HANDOFF_PARAMS: Record<ExternalChatProvider, string> = {
  whatsapp: 'whatsappPairing',
  slack: 'slackLogin',
};

export function handedOffProvider(
  search: Partial<Record<string, string | string[]>>
): ExternalChatProvider | undefined {
  return (Object.keys(HANDOFF_PARAMS) as ExternalChatProvider[]).find(
    (provider) => search[HANDOFF_PARAMS[provider]] !== undefined
  );
}
