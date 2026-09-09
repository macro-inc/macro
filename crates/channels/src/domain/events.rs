//! Domain events emitted by channel mutation workflows.

use crate::domain::models::{
    ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction, EntityMention,
    MutatedAttachment, MutatedMessage, PostMessageNotificationPolicy, Sender, SimpleMention,
    TypingAction,
};
use channel_sender::ChannelSender;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Notification context for a patched message that should notify like a new post.
#[derive(Debug, Clone)]
pub struct MessageChangedNotificationContext {
    /// Resolved channel metadata for downstream notifications.
    pub metadata: ChannelMetadata,
    /// Active channel participants at mutation time.
    pub participants: Vec<ChannelParticipant>,
    /// Mentions to use for notification routing.
    pub mentions: Vec<SimpleMention>,
    /// Whether the message contains attachments after the patch.
    pub has_attachments: bool,
}

/// Events emitted after durable channel state changes.
#[derive(Debug, Clone)]
pub enum ChannelEvent {
    /// A channel was created.
    ChannelCreated {
        /// Created channel id.
        channel_id: Uuid,
        /// Actor that created the channel.
        actor: ChannelSender<'static>,
        /// User the actor created the channel for, when the actor is a bot.
        on_behalf_of: Option<MacroUserIdStr<'static>>,
        /// Type of channel that was created.
        channel_type: ChannelType,
        /// Stored channel name; `None` for direct message / unnamed channels.
        channel_name: Option<String>,
        /// Active participants after creation.
        participant_user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// A channel was deleted.
    ChannelDeleted {
        /// Deleted channel id.
        channel_id: Uuid,
        /// Actor that deleted the channel.
        actor: ChannelSender<'static>,
    },
    /// A message was posted.
    MessagePosted {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Resolved channel metadata for downstream side effects.
        metadata: ChannelMetadata,
        /// Active channel participants at publish time.
        participants: Vec<ChannelParticipant>,
        /// Persisted message payload.
        message: MutatedMessage,
        /// Mentions attached to the message.
        mentions: Vec<SimpleMention>,
        /// Whether the message contains attachments.
        has_attachments: bool,
        /// Attachments persisted with the message.
        attachments: Vec<MutatedAttachment>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
        /// Internal notification policy for this post.
        notification_policy: PostMessageNotificationPolicy,
    },
    /// Message attachments changed.
    AttachmentsChanged {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Actor that changed the attachments.
        actor: Sender,
        /// Message whose attachments changed.
        message_id: Uuid,
        /// Current attachment set for the message.
        attachments: Vec<MutatedAttachment>,
        /// Attachments added by this mutation.
        added: Vec<MutatedAttachment>,
        /// Attachments removed by this mutation.
        removed: Vec<MutatedAttachment>,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// Message content changed.
    MessageChanged {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Actor that changed the message.
        actor: Sender,
        /// Persisted message payload after mutation.
        message: MutatedMessage,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
        /// Optional notification context when this patch should notify like a new post.
        posted_notification: Option<MessageChangedNotificationContext>,
    },
    /// Message tombstone state changed.
    MessageDeleted {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Actor that deleted the message.
        actor: Sender,
        /// Persisted message payload after deletion.
        message: MutatedMessage,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// Message reactions changed.
    ReactionChanged {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Actor that changed the reaction.
        actor: Sender,
        /// Message whose reactions changed.
        message_id: Uuid,
        /// Current grouped reaction state for the message.
        reactions: Vec<CountedReaction>,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// A user typing state changed.
    TypingChanged {
        /// Channel containing the typing update.
        channel_id: Uuid,
        /// Actor whose typing state changed.
        actor: Sender,
        /// Typing action.
        action: TypingAction,
        /// Optional thread id for thread-scoped typing.
        thread_id: Option<Uuid>,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// Participants were explicitly added to a channel.
    ParticipantsAdded {
        /// Channel receiving new participants.
        channel_id: Uuid,
        /// Type of channel that received participants.
        channel_type: ChannelType,
        /// Active participants after the addition.
        active_participant_user_ids: Vec<MacroUserIdStr<'static>>,
        /// Actor who initiated the add.
        invited_by: Sender,
        /// Newly added recipients.
        recipient_user_ids: Vec<MacroUserIdStr<'static>>,
        /// Resolved channel metadata for notification copy.
        metadata: ChannelMetadata,
        /// Optional message content associated with the invite.
        message_content: Option<String>,
    },
    /// A user joined a channel.
    ParticipantJoined {
        /// Channel that was joined.
        channel_id: Uuid,
        /// Type of channel that was joined.
        channel_type: ChannelType,
        /// Actor that joined the channel.
        user_id: Sender,
        /// Active participants after the join.
        active_participant_user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// Channel metadata was updated (rename).
    ChannelUpdated {
        /// Updated channel id.
        channel_id: Uuid,
        /// The user who updated the channel.
        actor: MacroUserIdStr<'static>,
        /// Stored channel name before the update.
        previous_name: Option<String>,
        /// New channel name.
        channel_name: Option<String>,
    },
    /// Participants were removed from a channel (admin removal or self-leave).
    ParticipantsRemoved {
        /// Channel the participants were removed from.
        channel_id: Uuid,
        /// Type of channel the participants were removed from.
        channel_type: ChannelType,
        /// The user who removed the participants; equals the sole removed
        /// user for a self-service leave.
        actor: MacroUserIdStr<'static>,
        /// Users removed by this mutation.
        removed_user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// A generic entity mention (e.g. a doc mentioning another entity) was recorded.
    EntityMentionCreated {
        /// The persisted mention row.
        mention: EntityMention,
    },
    /// A generic entity mention was removed.
    EntityMentionDeleted {
        /// The mention row that was deleted.
        mention: EntityMention,
    },
}
