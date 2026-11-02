import { useListChannelsQuery } from '../../../../lib/queries/channel/channels';
import { emailKeys } from '../../../../lib/queries/email/keys';
import { useEmailLinksQuery } from '../../../../lib/queries/email/link';
import {
  SettingsButton,
  SettingsPage,
  SettingsSection,
} from '../../primitives';
import {
  link,
  queryClient,
  refreshHeldAccountSources,
  releaseAccountSources,
  switchFixtureAccount,
} from './services';

/** Real shared query observers over controlled service responses. */
export function AccountSources() {
  queryClient.removeQueries({
    queryKey: emailKeys.links(link.macro_id).queryKey,
  });
  const links = useEmailLinksQuery();
  const channels = useListChannelsQuery();
  return (
    <main class="h-dvh bg-panel text-ink">
      <SettingsPage title="Account sources">
        <SettingsSection title="Current account">
          <output data-testid="account-inboxes">
            {links.isPending
              ? 'Loading'
              : links.data?.links.map((inbox) => inbox.email_address).join(',')}
          </output>
          <output data-testid="account-channels">
            {channels.isPending
              ? 'Loading'
              : channels.data?.map((channel) => channel.name).join(',')}
          </output>
          <SettingsButton onClick={refreshHeldAccountSources}>
            Hold refresh
          </SettingsButton>
          <SettingsButton onClick={switchFixtureAccount}>
            Switch account
          </SettingsButton>
          <SettingsButton onClick={releaseAccountSources}>
            Release old responses
          </SettingsButton>
        </SettingsSection>
      </SettingsPage>
    </main>
  );
}
