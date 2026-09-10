//! Domain events emitted by channel mutation workflows.

use crate::domain::models::{
    ChannelMetadata, ChannelParticipant, ChannelType, EntityMention, Sender,
};
use channel_sender::ChannelSender;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

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
    /// A shared message changed; channel policy consumes the canonical event.
    MessageCommitted {
        /// Canonical committed change.
        event: Box<messages::domain::ports::MessageEvent>,
        /// Notification and channel broker context, loaded for posts and edits.
        metadata: Option<ChannelMetadata>,
        /// Active participants when the effect was dispatched.
        participants: Vec<ChannelParticipant>,
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
