//! Conversions from channel domain models into their Soup wire shapes.

use crate::domain::models::{
    ChannelListItem, ChannelMessage, ChannelParticipant, ChannelType, ChannelWithLatest,
    ChannelWithParticipants, CountedReaction, LatestMessage, MessageAttachment, ParticipantRole,
    RecentChannelMessage, ThreadInfo, ThreadReply,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_soup::comms::{
    self as soup, OrganizationId, SoupChannel, SoupChannelThread, SoupCountedReaction,
    SoupMessageAttachment, SoupMessageSender, SoupThreadInfo, SoupThreadReply,
};

impl From<ChannelType> for soup::ChannelType {
    fn from(channel_type: ChannelType) -> Self {
        match channel_type {
            ChannelType::Public => Self::Public,
            ChannelType::Private => Self::Private,
            ChannelType::DirectMessage => Self::DirectMessage,
            ChannelType::Team => Self::Team,
        }
    }
}

impl From<ParticipantRole> for soup::ParticipantRole {
    fn from(role: ParticipantRole) -> Self {
        match role {
            ParticipantRole::Owner => Self::Owner,
            ParticipantRole::Admin => Self::Admin,
            ParticipantRole::Member => Self::Member,
        }
    }
}

impl From<ChannelListItem> for soup::Channel {
    fn from(channel: ChannelListItem) -> Self {
        Self {
            id: soup::ChannelId(channel.id),
            name: channel.name,
            channel_type: channel.channel_type.into(),
            org_id: channel
                .org_id
                .and_then(|org_id| u32::try_from(org_id).ok())
                .map(OrganizationId),
            team_id: channel.team_id,
            created_at: channel.created_at,
            updated_at: channel.updated_at,
            owner_id: channel.owner_id,
        }
    }
}

impl From<RecentChannelMessage> for soup::ChannelMessage {
    fn from(message: RecentChannelMessage) -> Self {
        Self {
            message_id: message.message_id,
            thread_id: message.thread_id,
            sender_id: message.sender_id,
            content: message.content,
            created_at: message.created_at,
            updated_at: message.updated_at,
            deleted_at: message.deleted_at,
            mentions: message.mentions,
        }
    }
}

impl From<LatestMessage> for soup::LatestMessage {
    fn from(latest_message: LatestMessage) -> Self {
        Self {
            latest_message: latest_message.latest_message.map(Into::into),
            latest_non_thread_message: latest_message.latest_non_thread_message.map(Into::into),
        }
    }
}

impl TryFrom<ChannelParticipant> for soup::ChannelParticipant {
    type Error = macro_user_id::error::ParseErr;

    fn try_from(participant: ChannelParticipant) -> Result<Self, Self::Error> {
        Ok(Self {
            channel_id: soup::ChannelId(participant.channel_id),
            user_id: MacroUserIdStr::parse_from_str(&participant.user_id)?.into_owned(),
            role: participant.role.into(),
            joined_at: participant.joined_at,
            left_at: participant.left_at,
        })
    }
}

impl From<ChannelWithParticipants> for soup::ChannelWithParticipants {
    fn from(channel: ChannelWithParticipants) -> Self {
        Self {
            channel: channel.channel.into(),
            participants: channel
                .participants
                .into_iter()
                .filter_map(|participant| participant.try_into().ok())
                .collect(),
            is_participant: channel.is_participant,
        }
    }
}

impl From<ChannelWithLatest> for SoupChannel {
    fn from(channel: ChannelWithLatest) -> Self {
        Self {
            channel: channel.channel.into(),
            latest_message: channel.latest_message.into(),
            viewed_at: channel.viewed_at,
            interacted_at: channel.interacted_at,
        }
    }
}

impl From<CountedReaction> for SoupCountedReaction {
    fn from(reaction: CountedReaction) -> Self {
        Self {
            emoji: reaction.emoji,
            users: reaction.users,
        }
    }
}

impl From<MessageAttachment> for SoupMessageAttachment {
    fn from(attachment: MessageAttachment) -> Self {
        Self {
            id: attachment.id,
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            width: attachment.width,
            height: attachment.height,
            created_at: attachment.created_at,
        }
    }
}

impl From<ThreadReply> for SoupThreadReply {
    fn from(reply: ThreadReply) -> Self {
        let (bot_name, bot_avatar_url) = reply.bot_profile.map_or((None, None), |profile| {
            (Some(profile.name), profile.avatar_url)
        });
        Self {
            id: reply.id,
            sender: SoupMessageSender::from_message_sender(
                &reply.sender_id,
                bot_name,
                bot_avatar_url,
            ),
            sender_id: reply.sender_id,
            content: reply.content,
            created_at: reply.created_at,
            updated_at: reply.updated_at,
            edited_at: reply.edited_at,
            reactions: reply.reactions.into_iter().map(Into::into).collect(),
            attachments: reply.attachments.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ThreadInfo> for SoupThreadInfo {
    fn from(thread: ThreadInfo) -> Self {
        Self {
            reply_count: thread.reply_count,
            latest_reply_at: thread.latest_reply_at,
            preview: thread.preview.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ChannelMessage> for SoupChannelThread {
    fn from(message: ChannelMessage) -> Self {
        let (bot_name, bot_avatar_url) = message.bot_profile.map_or((None, None), |profile| {
            (Some(profile.name), profile.avatar_url)
        });
        Self {
            id: message.id,
            channel_id: message.channel_id,
            sender: SoupMessageSender::from_message_sender(
                &message.sender_id,
                bot_name,
                bot_avatar_url,
            ),
            sender_id: message.sender_id,
            content: message.content,
            created_at: message.created_at,
            updated_at: message.updated_at,
            edited_at: message.edited_at,
            deleted_at: message.deleted_at,
            thread: message.thread.into(),
            reactions: message.reactions.into_iter().map(Into::into).collect(),
            attachments: message.attachments.into_iter().map(Into::into).collect(),
        }
    }
}
