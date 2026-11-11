import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import LinkIcon from '@icon/system/regular/link.svg';
import { useCallLinkQuery } from '@queries/call/meetings';
import { Dropdown } from '@ui';
import { Show, Suspense } from 'solid-js';
import { MeetingCopyButton } from '../../meetings/components/meeting-copy-button';
import { useQuickCallsFlag } from '../../meetings/use-quick-calls-flag';
import { useCallContext } from './CallContext';
import { getMeetingUrl } from './call-link';

function ActiveCallLinkContent(props: {
  compact?: boolean;
  menuItem?: boolean;
}) {
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

  async function copyFromMenu() {
    try {
      await copy();
      toast.success(t('calls.linkCopied'));
    } catch {
      toast.failure(t('calls.linkCopyFailed'));
    }
  }

  return (
    <Show
      when={props.menuItem}
      fallback={
        <MeetingCopyButton
          url={url()}
          onCopy={copy}
          disabled={!call.activeCallId()}
          compact={props.compact}
        />
      }
    >
      <Dropdown.Item
        disabled={!call.activeCallId() || link.isFetching}
        onSelect={() => fireAndForget(copyFromMenu(), 'call-link')}
      >
        <LinkIcon class="size-4 shrink-0" />
        <span class="flex-1 truncate">{t('calls.copyLink')}</span>
      </Dropdown.Item>
    </Show>
  );
}

export function ActiveCallLink(props: {
  compact?: boolean;
  menuItem?: boolean;
}) {
  const flag = useQuickCallsFlag();
  return (
    <Show when={!flag().loading && flag().enabled}>
      <Suspense>
        <ActiveCallLinkContent
          compact={props.compact}
          menuItem={props.menuItem}
        />
      </Suspense>
    </Show>
  );
}
