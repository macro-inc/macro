import { parseDate } from '@core/util/date';
import type {
  Activity as ApiActivity,
  Attachment as ApiAttachment,
  Channel as ApiChannel,
  ChannelParticipant as ApiChannelParticipant,
  GetChannelResponse as ApiGetChannelResponse,
  Message as ApiMessage,
} from '@service-comms/generated/models';

export type Message = Omit<
  ApiMessage,
  'created_at' | 'updated_at' | 'deleted_at' | 'edited_at'
> & {
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  edited_at?: Date | null;
};

export type Attachment = Omit<ApiAttachment, 'created_at'> & {
  created_at: Date;
};

export type ChannelParticipant = Omit<
  ApiChannelParticipant,
  'joined_at' | 'left_at'
> & {
  joined_at: Date;
  left_at?: Date | null;
};

export type Channel = Omit<ApiChannel, 'created_at' | 'updated_at'> & {
  created_at: Date;
  updated_at: Date;
};

export type Activity = Omit<
  ApiActivity,
  'created_at' | 'updated_at' | 'interacted_at' | 'viewed_at'
> & {
  created_at: Date;
  updated_at: Date;
  interacted_at?: Date | null;
  viewed_at?: Date | null;
};

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

export function convertMessage(m: ApiMessage): Message {
  return {
    ...m,
    created_at: parseDate(m.created_at),
    updated_at: parseDate(m.updated_at),
    deleted_at: m.deleted_at != null ? parseDate(m.deleted_at) : m.deleted_at,
    edited_at: m.edited_at != null ? parseDate(m.edited_at) : m.edited_at,
  };
}

export function convertAttachment(a: ApiAttachment): Attachment {
  return {
    ...a,
    created_at: parseDate(a.created_at),
  };
}

function convertParticipant(p: ApiChannelParticipant): ChannelParticipant {
  return {
    ...p,
    joined_at: parseDate(p.joined_at),
    left_at: p.left_at != null ? parseDate(p.left_at) : p.left_at,
  };
}

function convertChannel(c: ApiChannel): Channel {
  return {
    ...c,
    created_at: parseDate(c.created_at),
    updated_at: parseDate(c.updated_at),
  };
}

function convertActivity(a: ApiActivity): Activity {
  return {
    ...a,
    created_at: parseDate(a.created_at),
    updated_at: parseDate(a.updated_at),
    interacted_at:
      a.interacted_at != null ? parseDate(a.interacted_at) : a.interacted_at,
    viewed_at: a.viewed_at != null ? parseDate(a.viewed_at) : a.viewed_at,
  };
}

export function convertGetChannelResponse(
  data: ApiGetChannelResponse
): GetChannelResponse {
  return {
    ...data,
    channel: convertChannel(data.channel),
    messages: data.messages.map(convertMessage),
    attachments: data.attachments.map(convertAttachment),
    participants: data.participants.map(convertParticipant),
    activity:
      data.activity != null ? convertActivity(data.activity) : data.activity,
  };
}
