import type {
  Activity as ApiActivity,
  Attachment as ApiAttachment,
  Channel as ApiChannel,
  ChannelParticipant as ApiChannelParticipant,
  GetChannelResponse as ApiGetChannelResponse,
  Message as ApiMessage,
} from '@service-comms/generated/models';

export type Message = ApiMessage;

export type Attachment = ApiAttachment;

export type ChannelParticipant = ApiChannelParticipant;

export type Channel = ApiChannel;

export type Activity = ApiActivity;

export type GetChannelResponse = Omit<
  ApiGetChannelResponse,
  'channel' | 'messages' | 'attachments' | 'participants' | 'activity'
> & {
  channel: Channel;
  messages: Message[];
  attachments: Attachment[];
  participants: ChannelParticipant[];
  activity?: Activity | null;
};
