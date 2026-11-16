import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { createSignal } from 'solid-js';
import { createNoopCacheHost } from '../../../../lib/graphql-cache/host/noop-host';
import type { PeopleContextState } from '../../../../lib/graphql-cache/people/generated';
import { createPeopleCache } from '../../../../lib/graphql-cache/people/host';
import { useListChannelsQuery } from '../../../../lib/queries/channel/channels';
import type { PersonFacts } from '../../../../lib/queries/contacts/context-facts';
import { useContactContextPublisher } from '../../../../lib/queries/contacts/use-context-publisher';
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
  useUserId,
} from './services';

/** Real shared query observers over controlled service responses. */
export function AccountSources() {
  queryClient.removeQueries({
    queryKey: emailKeys.links(link.macro_id).queryKey,
  });
  const links = useEmailLinksQuery();
  const channels = useListChannelsQuery();
  const viewer = useUserId();
  let owner: string | undefined;
  let state: PeopleContextState = { kind: 'missing' };
  let revision = 0;
  const rows = new Map<string, PersonFacts>();
  const [published, setPublished] = createSignal('');
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    people: createPeopleCache({
      ...unsupportedContactSync,
      readSql: async () => ({ kind: 'unsupported' }),
      resolveReferences: async () => ({ kind: 'unsupported' }),
      context: async (scope) =>
        owner === scope.identity ? state : { kind: 'missing' },
      update: async (update) => {
        if (update.scope.identity !== viewer())
          throw new Error('cache hydration scope changed');
        if (update.action.kind === 'begin') {
          owner = update.scope.identity;
          state = { kind: 'building', epoch: update.epoch };
          rows.clear();
        } else if (state.kind === 'missing' || state.epoch !== update.epoch)
          throw new Error('contact search context changed');
        else if (update.action.kind === 'patch') {
          for (const patch of update.action.updates)
            rows.set(patch.userId, patch.facts);
        } else state = { kind: 'ready', epoch: update.epoch };
        if (state.kind === 'ready')
          setPublished(JSON.stringify({ owner, rows: [...rows] }));
        return String(++revision);
      },
      search: async () => ({ kind: 'contextPending' }),
    }),
  };
  const publication = useContactContextPublisher(
    () => host,
    () => 0
  );
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
          <output data-testid="contact-context-state">{publication()}</output>
          <output data-testid="contact-context-rows">{published()}</output>
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
