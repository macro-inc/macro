//! Domain events emitted by channel mutation workflows.

use crate::domain::{
    access_requests::ChannelAccessRequest,
    models::{
        ChannelMetadata, ChannelParticipant, ChannelType, EntityMention, MutatedMessage, Sender,
    },
};
use channel_sender::ChannelSender;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::{PostMessageNotificationPolicy, SimpleMention};
use uuid::Uuid;

use crate::domain::broker_events::ChannelTopicEvent;
use crate::domain::mention_events::MentionTopicEvent;
#[cfg(feature = "kafka_consumer")]
use macro_event_broker::TopicEvent;
use macro_event_broker::access::EventAccess;
#[cfg(feature = "kafka_consumer")]
use macro_event_topics::MacroTeamsTopic;
#[cfg(feature = "kafka_consumer")]
use serde::Deserialize;
use serde::Serialize;

/// Context needed to notify a channel message author about a reaction.
#[derive(Debug, Clone)]
pub struct ReactionNotificationContext {
    /// Emoji that was added.
    pub emoji: String,
    /// Author of the reacted-to message.
    pub message_sender: Sender,
    /// Root thread id when the reacted-to message is a reply.
    pub thread_id: Option<Uuid>,
    /// Reacted-to message body.
    pub message_content: String,
    /// Channel display metadata.
    pub metadata: ChannelMetadata,
}

/// Events emitted after durable channel state changes.
#[derive(Debug, Clone)]
pub enum ChannelEvent {
    /// A channel picture was set, replaced, or removed.
    PictureChanged {
        /// User who changed the picture.
        actor: MacroUserIdStr<'static>,
        /// Channel whose picture changed.
        channel_id: Uuid,
        /// Active participants whose sessions should refresh the picture.
        recipients: Vec<MacroUserIdStr<'static>>,
    },
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
        /// Users who were active participants before the delete.
        participant_user_ids: Vec<MacroUserIdStr<'static>>,
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
        /// Internal notification policy for this post.
        notification_policy: PostMessageNotificationPolicy,
    },
    /// A user added a reaction to a message by another user.
    ReactionAdded {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Actor that added the reaction.
        actor: Sender,
        /// Message that received the reaction.
        message_id: Uuid,
        /// Data used to format the author notification.
        notification: ReactionNotificationContext,
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
    /// Someone outside a channel asked to join it.
    AccessRequested {
        /// The new attempt.
        request: ChannelAccessRequest,
        /// The requester's profile name, if they have one, for the timeline.
        requester_name: Option<String>,
        /// Active participants, any of whom may answer it.
        participant_user_ids: Vec<MacroUserIdStr<'static>>,
        /// Resolved channel metadata for notification copy.
        metadata: ChannelMetadata,
    },
    /// A request to join was approved, denied, or withdrawn.
    AccessRequestResolved {
        /// The attempt after resolution.
        request: ChannelAccessRequest,
        /// Active participants, whose notifications about it are now done.
        participant_user_ids: Vec<MacroUserIdStr<'static>>,
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

impl EventAccess for ChannelTopicEvent {
    type PublicPayload = Self;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, Audience, EntityRef, EntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, channel_id) = match self {
            Self::Created(metadata) => ("channel.created", metadata.channel_id),
            Self::Updated(metadata) => ("channel.updated", metadata.channel_id),
            Self::PictureChanged(metadata) => ("channel.picture_changed", metadata.channel_id),
            Self::Deleted(metadata) => ("channel.deleted", metadata.channel_id),
            Self::ParticipantAdded(metadata) => ("channel.participant_added", metadata.channel_id),
            Self::ParticipantRemoved(metadata) => {
                ("channel.participant_removed", metadata.channel_id)
            }
            Self::AccessRequested(metadata) => ("channel.access_requested", metadata.channel_id),
        };
        let channel_id = channel_id.to_string();
        let channel = Audience::Entity {
            entity_type: EntityType::Channel,
            entity_id: channel_id.clone(),
        };
        let (audience, payload) = match self {
            // Participant rows cascade with the channel: the captured
            // participants are the audience, and the snapshot is routing
            // only, stripped from the delivered payload.
            Self::Deleted(metadata) if !metadata.participant_user_ids.is_empty() => {
                let mut payload = metadata.clone();
                let participants = std::mem::take(&mut payload.participant_user_ids);
                (
                    Audience::Any(vec![
                        channel,
                        Audience::Snapshot {
                            user_ids: participants,
                        },
                    ]),
                    Cow::Owned(Self::Deleted(payload)),
                )
            }
            Self::Deleted(_)
            | Self::Created(_)
            | Self::Updated(_)
            | Self::PictureChanged(_)
            | Self::ParticipantAdded(_)
            | Self::ParticipantRemoved(_)
            | Self::AccessRequested(_) => (channel, Cow::Borrowed(self)),
        };
        Ok(Access::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Channel, channel_id),
            audience,
            stage: Stage::Stable,
            payload,
        }))
    }
}

impl EventAccess for MentionTopicEvent {
    type PublicPayload = MentionPublicEvent;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, AccessError, Audience, EntityRef as PublicEntityRef, EntityType, PublicEvent,
            Stage,
        };
        use std::borrow::Cow;
        use std::str::FromStr as _;

        let (name, metadata, wrap): (_, _, fn(PublicMention) -> MentionPublicEvent) = match self {
            Self::Created(metadata) => ("mention.created", metadata, MentionPublicEvent::Created),
            Self::Deleted(metadata) => ("mention.deleted", metadata, MentionPublicEvent::Deleted),
            Self::MessageSent(_) => {
                return Ok(Access::Internal {
                    reason: "message.mentioned already delivers each message mention to the message's audience",
                });
            }
        };
        // The API only records mentions from documents, but the source kind
        // travels as a string; any kind that is not an entity type is a
        // contract violation.
        let source_type = EntityType::from_str(&metadata.source.kind).map_err(|_| {
            AccessError::InvalidEntityId {
                entity_type: "mention source",
                entity_id: metadata.source.kind.clone(),
            }
        })?;
        let source_id = metadata.source.id.clone();
        Ok(Access::Public(PublicEvent {
            name,
            entity: PublicEntityRef::new(source_type, source_id.clone()),
            audience: Audience::Entity {
                entity_type: source_type,
                entity_id: source_id.clone(),
            },
            stage: Stage::Preview,
            payload: Cow::Owned(wrap(PublicMention {
                source_type,
                source_id,
                mentioned_kind: metadata.mentioned.kind.clone(),
                mentioned_id: metadata.mentioned.id.clone(),
            })),
        }))
    }
}

/// The public projection of [`MentionTopicEvent`], delivered to the explicit
/// accessors of the entity the mention appears in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum MentionPublicEvent {
    /// A mention was added to an entity, such as a document.
    #[serde(rename = "mention.created")]
    Created(PublicMention),
    /// A mention was removed from an entity.
    #[serde(rename = "mention.deleted")]
    Deleted(PublicMention),
}

/// Public body of a mention event: where the mention is and what it names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicMention {
    /// Type of the entity the mention appears in.
    pub source_type: macro_event_broker::access::EntityType,
    /// The entity the mention appears in.
    pub source_id: String,
    /// Kind of the mentioned entity, such as `user` or `document`.
    pub mentioned_kind: String,
    /// The mentioned entity.
    pub mentioned_id: String,
}

#[cfg(feature = "kafka_consumer")]
/// Channels-owned view of `team.member_joined` for ensuring teammate DMs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TeammateDmsJoinedMetadata {
    /// User who joined the team.
    pub member_id: MacroUserIdStr<'static>,
    /// Other current teammates the joining member should have a DM with.
    #[serde(default)]
    pub teammate_ids: Vec<MacroUserIdStr<'static>>,
}

#[cfg(feature = "kafka_consumer")]
/// Tagged envelope around a `team.member_joined` payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub(crate) enum MemberJoinedEnvelope {
    /// Join payload used to ensure teammate DMs.
    #[serde(rename = "team.member_joined")]
    Payload(TeammateDmsJoinedMetadata),
}

#[cfg(feature = "kafka_consumer")]
/// Placeholder for team events this consumer ignores.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct IgnoredTeamEvent {
    pub(crate) event_type: String,
}

#[cfg(feature = "kafka_consumer")]
/// Wire view of `macro.teams` records this consumer acts on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum TeamsTopicForDms {
    /// A member joined; create teammate DMs from the payload roster.
    MemberJoined(MemberJoinedEnvelope),
    /// Any other team event; ignored and committed.
    Other(IgnoredTeamEvent),
}

#[cfg(feature = "kafka_consumer")]
impl TopicEvent for TeamsTopicForDms {
    type Topic = MacroTeamsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

#[cfg(feature = "kafka_consumer")]
impl EventAccess for TeamsTopicForDms {
    type PublicPayload = macro_event_broker::access::Unexposed;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::Access;

        Ok(match self {
            Self::MemberJoined(_) | Self::Other(_) => Access::Internal {
                reason: "consumer-side decoding of macro.teams; TeamTopicEvent declares the topic access",
            },
        })
    }
}
