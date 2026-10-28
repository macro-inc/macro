import { useCallLinkQuery } from '@queries/call/meetings';
import { Show, Suspense } from 'solid-js';
import { MeetingCopyButton } from '../../meetings/components/meeting-copy-button';
import { useQuickCallsFlag } from '../../meetings/use-quick-calls-flag';
import { useCallContext } from './CallContext';
import { getMeetingUrl } from './call-link';

function ActiveCallLinkContent() {
  const call = useCallContext();
  // Creating a share link grants access, so fetch only on an explicit copy.
  const link = useCallLinkQuery(() => call.activeCallId() ?? undefined, {
    enabled: false,
  });
  const url = () => (link.isSuccess ? getMeetingUrl(link.data.shareToken) : '');

  async function copy() {
    if (!call.activeCallId()) return;
    const result = await link.refetch();
    if (!result.isSuccess) throw result.error;
    await navigator.clipboard.writeText(getMeetingUrl(result.data.shareToken));
  }

  return (
    <MeetingCopyButton
      url={url()}
      onCopy={copy}
      disabled={!call.activeCallId()}
    />
  );
}

export function ActiveCallLink() {
  const flag = useQuickCallsFlag();
  return (
    <Show when={!flag().loading && flag().enabled}>
      <Suspense>
        <ActiveCallLinkContent />
      </Suspense>
    </Show>
  );
}
