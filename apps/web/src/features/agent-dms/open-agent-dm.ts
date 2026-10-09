import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';

/** App navigation adapter for a persona's Message action. */
export function useOpenAgentDm() {
  const mutation = useGetOrCreateDirectMessageMutation();
  const { replaceSplit } = useSplitLayout();

  const open = async (botId: string) => {
    try {
      const dm = await mutation.mutateAsync({ recipient_id: `bot|${botId}` });
      replaceSplit({ content: { type: 'channel', id: dm.channel_id } });
    } catch {
      toast.failure('Could not open this conversation. Please try again.');
    }
  };

  return { open, pending: () => mutation.isPending };
}
