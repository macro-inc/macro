import type { CacheHost } from '@graphql-cache/host/types';
import { type Accessor, createSignal } from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import type { ContextChannel } from './context-facts';
import { createContactContextSource } from './context-source';
import { createContactContextSync } from './context-sync';

/** Soup supplies its existing leader/rollout host and generation lifecycle;
 * `channels` is the viewer's complete channel directory, undefined until it
 * is complete. */
export function useContactContextPublisher(
  host: Accessor<CacheHost | undefined>,
  generation: Accessor<number>,
  channels: Accessor<readonly ContextChannel[] | undefined>
) {
  const account = useQueryAccount();
  const [unsupported, setUnsupported] = createSignal(false);
  const source = createContactContextSource({
    account,
    channels,
    enabled: () =>
      !!account() && !!host()?.people && !host()?.disabled && !unsupported(),
  });
  return createContactContextSync({
    account,
    host,
    generation,
    source,
    onUnsupported: setUnsupported,
  });
}
