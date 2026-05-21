//! Domain events emitted by channel mutation workflows.

use crate::domain::models::{
    ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction, MutatedAttachment,
    MutatedMessage, SimpleMention, TypingAction,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Events emitted after durable channel state changes.
#[derive(Debug, Clone)]
pub enum ChannelEvent {
    /// A channel was created.
    ChannelCreated {
        /// Created channel id.
        channel_id: Uuid,
        /// Type of channel that was created.
        channel_type: ChannelType,
        /// Active participants after creation.
        participant_user_ids: Vec<MacroUserIdStr<'static>>,
    },
    /// A channel was deleted.
    ChannelDeleted {
        /// Deleted channel id.
        channel_id: Uuid,
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
    },
    /// Message attachments changed.
    AttachmentsChanged {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Message whose attachments changed.
        message_id: Uuid,
        /// Current attachment set for the message.
        attachments: Vec<MutatedAttachment>,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// Message content changed.
    MessageChanged {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Persisted message payload after mutation.
        message: MutatedMessage,
        /// Realtime recipients at mutation time.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Client mutation nonce echoed to realtime listeners.
        nonce: Option<String>,
    },
    /// Message tombstone state changed.
    MessageDeleted {
        /// Channel containing the message.
        channel_id: Uuid,
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
        /// User whose typing state changed.
        user_id: String,
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
        /// User who initiated the add.
        invited_by_user_id: MacroUserIdStr<'static>,
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
        /// User that joined the channel.
        user_id: MacroUserIdStr<'static>,
        /// Active participants after the join.
        active_participant_user_ids: Vec<MacroUserIdStr<'static>>,
    },
}
