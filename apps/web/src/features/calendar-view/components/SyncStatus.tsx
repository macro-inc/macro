import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { UserProvider } from '@service-email/generated/schemas/userProvider';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';

type ImportProvider = 'Google' | 'Outlook';

/**
 * The sync status says only that some account is still importing, not which
 * one, so a provider is named only when every connected inbox, delegated ones
 * included, uses it. Mixed or unloaded inboxes name none.
 */
function importProvider(
  links: readonly EmailLink[]
): ImportProvider | undefined {
  const [first, ...rest] = links;
  if (!first || rest.some((link) => link.provider !== first.provider)) {
    return undefined;
  }
  return match(first.provider)
    .with(UserProvider.GMAIL, (): ImportProvider => 'Google')
    .with(UserProvider.OUTLOOK, (): ImportProvider => 'Outlook')
    .exhaustive(() => undefined);
}

/** Keep backfill progress visible while events arrive and the grid is usable. */
export function SyncStatus(props: { syncing: boolean }) {
  const linksQuery = useEmailLinksQuery();
  const provider = () =>
    linksQuery.isSuccess ? importProvider(linksQuery.data.links) : undefined;

  return (
    <Show when={props.syncing}>
      <div
        role="status"
        class="flex shrink-0 items-center gap-3 border-b border-edge-muted bg-surface px-4 py-3"
      >
        <SpinnerIcon class="size-4 shrink-0 animate-spin motion-reduce:animate-none text-accent" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium text-ink">
            Syncing your calendar…
          </span>
          <span class="text-xs text-ink-muted">
            <Show when={provider()} fallback="Events are still being imported.">
              {(name) => `Events are still being imported from ${name()}.`}
            </Show>{' '}
            This may take a while, and some days may look empty until the import
            finishes. You can keep using Macro.
          </span>
        </div>
      </div>
    </Show>
  );
}
