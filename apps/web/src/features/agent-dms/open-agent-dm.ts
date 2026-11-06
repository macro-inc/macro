import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';

/** App navigation adapter for a persona's Message action. */
export function useOpenAgentDm() {
  const mutation = useGetOrCreateDirectMessageMutation();
  const { replaceSplit } = useSplitLayout();
  const settings = useSettingsState();

  const open = async (botId: string) => {
    try {
      const dm = await mutation.mutateAsync({ recipient_id: `bot|${botId}` });
      replaceSplit({ content: { type: 'channel', id: dm.channel_id } });
      // On a phone, settings is a sheet over the conversation just opened;
      // elsewhere the conversation took the settings split's place.
      if (isMobile()) settings.closeSettings();
    } catch {
      toast.failure('Could not open this conversation. Please try again.');
    }
  };

  return { open, pending: () => mutation.isPending };
}
