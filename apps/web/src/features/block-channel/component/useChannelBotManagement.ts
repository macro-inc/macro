import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  requestBotCreation,
  requestBotDetail,
} from '@channel/Bots/botSettingsState';
import { channelWebhookUrl } from '@channel/Bots/webhook';
import { toast } from '@core/component/Toast/Toast';
import { botManagement } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useChannelType } from '@core/context/channels';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import CopyIcon from '@phosphor/copy.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import { ChannelTypeEnum } from '@service-storage/client';
import { createSignal, onCleanup } from 'solid-js';

type UseChannelBotManagementOptions = {
  channelId: string;
  hotkeyScopeId: string;
  openParticipants: () => void;
};

export function useChannelBotManagement(
  options: UseChannelBotManagementOptions
) {
  const { openSettings } = useSettingsState();
  const channelType = useChannelType(options.channelId);
  const featureFlag = useFeatureFlag(botManagement);
  const [inviteFocusRequest, setInviteFocusRequest] = createSignal(0);

  const enabled = () => featureFlag().enabled;
  const canManageBots = () =>
    enabled() && channelType() === ChannelTypeEnum.Private;

  const openCreateBot = () => {
    requestBotCreation(options.channelId);
    openSettings('Bots');
  };

  const openInviteBot = () => {
    options.openParticipants();
    setInviteFocusRequest((request) => request + 1);
  };

  const openBot = (botId: string) => {
    requestBotDetail(botId);
    openSettings('Bots');
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(channelWebhookUrl(options.channelId));
      toast.success('Webhook URL copied');
    } catch {
      toast.failure('Failed to copy webhook URL');
    }
  };

  // Unkeyed commands appear in the command menu while this channel's split is
  // active, even when a child input or message-list scope owns focus.
  const commandGroup = createHotkeyGroup();

  registerHotkey({
    scopeId: options.hotkeyScopeId,
    description: 'Create bot for channel',
    icon: PlusIcon,
    keywords: ['webhook', 'automation', 'agent'],
    displayPriority: 9,
    condition: canManageBots,
    keyDownHandler: () => {
      openCreateBot();
      return true;
    },
  }).withGroup(commandGroup);

  registerHotkey({
    scopeId: options.hotkeyScopeId,
    description: 'Invite bot to channel',
    icon: RobotIcon,
    keywords: ['add bot', 'webhook', 'participant'],
    displayPriority: 9,
    condition: canManageBots,
    keyDownHandler: () => {
      openInviteBot();
      return true;
    },
  }).withGroup(commandGroup);

  registerHotkey({
    scopeId: options.hotkeyScopeId,
    description: 'Copy channel webhook URL',
    icon: CopyIcon,
    keywords: ['bot', 'webhook', 'endpoint'],
    displayPriority: 8,
    condition: enabled,
    keyDownHandler: () => {
      void copyWebhookUrl();
      return true;
    },
  }).withGroup(commandGroup);

  onCleanup(() => commandGroup.dispose());

  return {
    enabled,
    inviteFocusRequest,
    openBot,
    openCreateBot,
  };
}
