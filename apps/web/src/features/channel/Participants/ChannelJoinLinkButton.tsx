import { toast } from '@core/component/Toast/Toast';
import { getWebOrigin } from '@core/util/webOrigin';
import CheckIcon from '@phosphor/check.svg';
import LinkIcon from '@phosphor/link.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useGetChannelJoinLinkMutation } from '@queries/channel/join-links';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';

export function ChannelJoinLinkButton(props: { channelId: string }) {
  const getJoinLinkMutation = useGetChannelJoinLinkMutation();
  const [joinCode, setJoinCode] = createSignal<string>();
  const [copied, setCopied] = createSignal(false);
  let copyResetTimeout: ReturnType<typeof setTimeout> | undefined;
  let joinCodeRequest: Promise<string | undefined> | undefined;

  onCleanup(() => clearTimeout(copyResetTimeout));

  const generateJoinCode = async (): Promise<string | undefined> => {
    try {
      const response = await getJoinLinkMutation.mutateAsync({
        channelId: props.channelId,
      });
      setJoinCode(response.join_code);
      return response.join_code;
    } catch {
      // The mutation displays the standard generation failure toast.
      return undefined;
    }
  };

  const getJoinCode = async (): Promise<string | undefined> => {
    const existingCode = joinCode();
    if (existingCode) return existingCode;
    if (joinCodeRequest) return await joinCodeRequest;

    joinCodeRequest = generateJoinCode();
    try {
      return await joinCodeRequest;
    } finally {
      joinCodeRequest = undefined;
    }
  };

  const buttonLabel = () => {
    if (getJoinLinkMutation.isPending) return 'Generating link';
    if (copied()) return 'Copied';
    return 'Copy invite link';
  };

  const copyJoinLink = async () => {
    if (getJoinLinkMutation.isPending) return;

    const code = await getJoinCode();
    if (!code) return;

    try {
      await navigator.clipboard.writeText(
        `${getWebOrigin()}/app/channel-invite?code=${code}`
      );
    } catch (error) {
      console.error('Failed to copy channel join link', error);
      toast.failure('Failed to copy channel join link');
      return;
    }

    setCopied(true);
    clearTimeout(copyResetTimeout);
    copyResetTimeout = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      class="rounded-xs"
      disabled={getJoinLinkMutation.isPending}
      onClick={() => void copyJoinLink()}
    >
      <Show
        when={!getJoinLinkMutation.isPending}
        fallback={<SpinnerIcon class="size-4 animate-spin" />}
      >
        <Show when={copied()} fallback={<LinkIcon class="size-4" />}>
          <CheckIcon class="size-4" />
        </Show>
      </Show>
      {buttonLabel()}
    </Button>
  );
}
