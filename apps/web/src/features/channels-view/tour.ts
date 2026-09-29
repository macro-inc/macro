import { VIEW_SHELL_TOUR } from '@app/components/view-shell';
import { CHANNEL_TOUR } from '@app/features/channel/tour';
import { defineViewTour } from '@app/features/tours/core/view-tour';
import { defineTourTargets } from '@ui/components/Tour';

export const CHANNELS_TOUR = defineTourTargets('channels', [
  'list',
  'create',
  'conversation',
]);

/** Steps inside a conversation wait on a row in the rail, or on the toggle
 * that shows the rail when the sidebar is collapsed. */
const openConversation = {
  entry: [CHANNELS_TOUR.conversation, VIEW_SHELL_TOUR.sidebarToggle],
  entryLabel: 'Open a channel or DM to continue',
  missingHint: 'Select a channel or DM to see this feature highlighted.',
};

export const channelsTour = defineViewTour({
  id: 'channels',
  title: 'Channels',
  video: {
    youtubeId: '1gDOXUxHo0U',
    title: 'What Macro learned from Slack/Superhuman',
    duration: '5:56',
  },
  steps: [
    {
      target: CHANNELS_TOUR.list,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the channel list to continue',
      title: 'Channels and DMs, together',
      description:
        'Organize work in shared channels, and use DMs for smaller conversations. All and Recent help you return to the right discussion.',
    },
    {
      target: CHANNELS_TOUR.create,
      entry: VIEW_SHELL_TOUR.sidebarToggle,
      entryLabel: 'Show the channel list to continue',
      title: 'Bring your team into the room',
      description:
        'Use the + beside Channels to create a shared space, or the + beside DMs to start a direct message. Choose the people who need the context.',
    },
    {
      target: CHANNEL_TOUR.messages,
      ...openConversation,
      title: 'Follow a thread, keep the context',
      description:
        'Open a conversation, then reply to a message in a thread. The discussion stays attached to the original message instead of getting lost in the channel.',
    },
    {
      target: CHANNEL_TOUR.composer,
      ...openConversation,
      title: 'Bring agents and work into chat',
      description:
        'Type @ to mention a teammate or agent, or link a document, task, or call. Everyone in the conversation can follow the shared context they have access to.',
    },
    {
      target: CHANNEL_TOUR.call,
      ...openConversation,
      title: 'Go from messages to a call',
      description:
        'Use the phone button to start or join a call in this conversation. The call stays connected to the channel so the team can return to its context.',
    },
  ],
});
