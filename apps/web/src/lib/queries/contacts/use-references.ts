import { type Accessor, createMemo } from 'solid-js';
import { useEmailLinksQuery } from '../email/link';
import { queryReadyGate } from '../gate';
import { canonicalContactUserId } from './contact-user-id';
import { createContactReferenceSource } from './reference-query';
import type { ContactReferenceRequest } from './references';
import { useContactDirectoryScope } from './use-directory';

/** Production composition for inference/imports. Suggestions use their own
 * picker sources; this source resolves only the current requested labels. */
export function useContactReferences(
  request: Accessor<Omit<ContactReferenceRequest, 'secondaryInboxIds'>>,
  enabled: Accessor<boolean> = () => true
) {
  const needsInboxes = () =>
    enabled() &&
    request().excludeSecondaryInboxes &&
    request().labels.length > 0;
  const links = useEmailLinksQuery(needsInboxes);
  const secondary = createMemo(() => {
    if (!needsInboxes() || !queryReadyGate(links)) return undefined;
    return links.data.links.flatMap((link) => {
      if (link.is_primary) return [];
      const id = canonicalContactUserId(`macro|${link.email_address}`);
      return id ? [id] : [];
    });
  });
  const source = createContactReferenceSource(
    useContactDirectoryScope(),
    () => ({ ...request(), secondaryInboxIds: secondary() }),
    enabled
  );
  return {
    ...source,
    loading: () =>
      source.loading() ||
      (!source.ready() && !source.error() && needsInboxes() && links.isPending),
    error: () =>
      source.error() ??
      (!source.ready() && needsInboxes() && links.isError ? links.error : null),
    retry: async () => {
      if (needsInboxes() && !queryReadyGate(links))
        await links.refetch({ cancelRefetch: false });
      return source.retry();
    },
  };
}
