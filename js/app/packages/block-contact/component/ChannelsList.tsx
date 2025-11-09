import { CircleSpinner } from '@core/component/CircleSpinner';
import { type ChannelWithParticipants, emailToId } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import Hash from '@icon/regular/hash.svg?component-solid';
import Users from '@icon/regular/users.svg?component-solid';
import { For, onMount, Show } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { commsServiceClient } from '../../service-comms/client';
import {
  contactChannelsSignal,
  isLoadingChannelsSignal,
} from '../signal/channelsSignal';

export function ChannelsList(props: { contactEmail: string }) {
  const contactChannels = contactChannelsSignal.get;
  const setContactChannels = contactChannelsSignal.set;
  const isLoadingChannels = isLoadingChannelsSignal.get;
  const setIsLoadingChannels = isLoadingChannelsSignal.set;

  const { replaceOrInsertSplit } = useSplitLayout();

  onMount(async () => {
    await loadChannelsForContact();
  });

  async function loadChannelsForContact() {
    setIsLoadingChannels(true);

    try {
      // Get all channels the current user is in
      const channelsResult = await commsServiceClient.getChannels();

      if (!isErr(channelsResult)) {
        const [, channelsData] = channelsResult;
        const allChannels = channelsData.channels || [];

        // Convert email to user ID format
        const contactUserId = emailToId(props.contactEmail);

        // Filter channels that include our contact
        const channelsWithContact = allChannels.filter((channel) =>
          channel.participants.some(
            (participant) =>
              participant.user_id === contactUserId && !participant.left_at
          )
        );

        // Sort by channel name or ID
        channelsWithContact.sort((a, b) => {
          const aName = a.name || a.id;
          const bName = b.name || b.id;
          return aName.localeCompare(bName);
        });

        setContactChannels(channelsWithContact);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setIsLoadingChannels(false);
    }
  }

  const getChannelIcon = (channel: ChannelWithParticipants) => {
    // DM channels typically have exactly 2 participants
    return channel.participants.length === 2 ? Users : Hash;
  };

  const getChannelDisplayName = (channel: ChannelWithParticipants) => {
    if (channel.name) return channel.name;

    // For DMs without a name, show "Direct Message"
    if (channel.participants.length === 2) {
      return 'Direct Message';
    }

    return channel.id;
  };

  return (
    <div class="space-y-2">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-medium text-ink-muted min-w-[60px]">
          Channels:
        </span>
        <Show
          when={!isLoadingChannels()}
          fallback={
            <div class="flex items-center">
              <CircleSpinner />
            </div>
          }
        >
          <Show
            when={contactChannels().length > 0}
            fallback={
              <span class="text-sm text-ink-extra-muted italic">
                No shared channels
              </span>
            }
          >
            <div class="flex-1 flex flex-wrap gap-2">
              <For each={contactChannels()}>
                {(channel) => {
                  const Icon = getChannelIcon(channel);
                  return (
                    <button
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-edge/30 hover:bg-hover rounded-md hover-transition-bg"
                      onClick={() =>
                        replaceOrInsertSplit({
                          type: 'channel',
                          id: channel.id,
                        })
                      }
                    >
                      <Icon class="w-3 h-3" />
                      <span>{getChannelDisplayName(channel)}</span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
