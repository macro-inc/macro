//! The pure evaluator: what a notification is, and which stack takes it.

#[cfg(test)]
mod test;

use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::{
    ChannelType, CommonChannelMetadata, InitiativeDiscussionReason, NotifEvent,
    NotificationDocumentSubType,
};
use notification::domain::models::NotificationLane;

use crate::domain::models::{
    NotificationStack, RoutingOutcome, RoutingRecord, StackKind, StackRule, StackSource,
};

/// Where a stack sent one recipient's notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Routed {
    /// The lane the notification lands in: the stack's lane when captured,
    /// signal when released.
    pub lane: NotificationLane,
    /// Why.
    pub record: RoutingRecord,
}

/// What the rules can ask about one notification. It is the same for every
/// recipient.
#[derive(Debug, Clone, PartialEq)]
pub struct Conversation {
    /// The kind of notification.
    pub kind: StackKind,
    /// Where it happened.
    pub place: Place,
    /// The person who caused it.
    pub sender: Option<MacroUserIdStr<'static>>,
}

/// Where a notification happened.
#[derive(Debug, Clone, PartialEq)]
pub enum Place {
    /// A channel.
    Channel {
        /// The channel's id.
        id: String,
        /// The channel's name as the notification carries it.
        name: String,
        /// The channel's type.
        channel_type: ChannelType,
    },
    /// The comments on a document or task.
    Document {
        /// The document's id.
        id: String,
        /// Whether the document is a task.
        is_task: bool,
        /// Where the document is filed.
        placement: DocumentPlacement,
    },
    /// The discussion on a task project.
    Project {
        /// The project's id.
        id: String,
    },
}

/// Where a document is filed. Empty until a rule needs it and it is loaded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DocumentPlacement {
    /// The folder the document is in and every folder above it.
    pub folders: Vec<String>,
    /// The task project a task belongs to.
    pub project: Option<String>,
}

impl Conversation {
    /// Read a notification as a conversation, or `None` for every kind a
    /// stack never captures: email, calendar, access requests, agents, pull
    /// requests, invites, calls and task assignment.
    pub fn of(
        event: &NotifEvent,
        entity: &Entity<'_>,
        sender: Option<&MacroUserIdStr<'_>>,
    ) -> Option<Self> {
        let (kind, place) = match event {
            NotifEvent::ChannelMention(mention) => {
                (StackKind::Mention, channel(entity, &mention.common)?)
            }
            NotifEvent::ChannelMessageReply(reply) => {
                (StackKind::Reply, channel(entity, &reply.common)?)
            }
            NotifEvent::ChannelMessageSend(message) => {
                (StackKind::NewMessage, channel(entity, &message.common)?)
            }
            NotifEvent::ChannelMessageReaction(reaction) => {
                (StackKind::Reaction, channel(entity, &reaction.common)?)
            }
            NotifEvent::DocumentMention(mention) => (
                StackKind::DocumentMention,
                channel(entity, &mention.channel.common)?,
            ),
            NotifEvent::MentionedInDocumentComment(comment) => (
                StackKind::Mention,
                document(entity, comment.sub_type.as_ref())?,
            ),
            NotifEvent::RepliedToDocumentCommentThread(comment) => (
                StackKind::Reply,
                document(entity, comment.sub_type.as_ref())?,
            ),
            NotifEvent::CommentedOnDocument(comment) => (
                StackKind::Comment,
                document(entity, comment.sub_type.as_ref())?,
            ),
            NotifEvent::InitiativeDiscussion(discussion) => {
                let kind = match discussion.reason {
                    InitiativeDiscussionReason::Mention => StackKind::Mention,
                    InitiativeDiscussionReason::Reply => StackKind::Reply,
                    InitiativeDiscussionReason::Assignee | InitiativeDiscussionReason::Owner => {
                        StackKind::Comment
                    }
                };
                (kind, project(entity)?)
            }
            NotifEvent::EntityAccessRequested(_)
            | NotifEvent::EntityAccessGranted(_)
            | NotifEvent::CrmDiscussion(_)
            | NotifEvent::ChannelInvite(_)
            | NotifEvent::CallStarted(_)
            | NotifEvent::NewEmail(_)
            | NotifEvent::InboxReauthRequired(_)
            | NotifEvent::InviteToTeam(_)
            | NotifEvent::TaskAssigned(_)
            | NotifEvent::Reminder(_)
            | NotifEvent::ExternalChatMessage(_)
            | NotifEvent::CalendarEventReminder(_)
            | NotifEvent::AiResponse(_)
            | NotifEvent::GithubPrStatusChanged(_)
            | NotifEvent::GithubPrCheckRun(_)
            | NotifEvent::GithubReviewRequested(_)
            | NotifEvent::GithubPrComment(_)
            | NotifEvent::GithubPrMention(_)
            | NotifEvent::GithubPrReview(_)
            | NotifEvent::AgentSessionSettled(_)
            | NotifEvent::AgentSessionWaitingForInput(_)
            | NotifEvent::AgentSessionMentioned(_)
            | NotifEvent::CalendarEventJoinRequest(_)
            | NotifEvent::ChannelAccessRequested(_)
            | NotifEvent::RoutineRunFinished(_)
            | NotifEvent::AgentSignInExpiry(_)
            | NotifEvent::RuntimeAccessRemoved(_) => return None,
        };

        Some(Self {
            kind,
            place,
            sender: sender.map(|sender| sender.clone().into_owned()),
        })
    }

    /// Route the notification for the owner of `stacks`, which are in
    /// position order. The first stack with a matching capture rule takes
    /// it; its release rules then decide whether it is let through. `None`
    /// when no stack captures it.
    pub fn route(&self, stacks: &[NotificationStack]) -> Option<Routed> {
        stacks.iter().find_map(|stack| {
            let capture_rule = stack.capture.iter().position(|rule| rule.matches(self))?;
            let release_rule = stack.release.iter().position(|rule| rule.matches(self));

            let (outcome, lane) = match release_rule {
                Some(_) => (RoutingOutcome::Released, NotificationLane::Signal),
                None => (RoutingOutcome::Captured, stack.lane),
            };

            Some(Routed {
                lane,
                record: RoutingRecord {
                    stack_id: stack.id,
                    stack_revision: stack.revision,
                    outcome,
                    capture_rule,
                    release_rule,
                },
            })
        })
    }
}

fn channel(entity: &Entity<'_>, common: &CommonChannelMetadata) -> Option<Place> {
    (entity.entity_type == EntityType::Channel).then(|| Place::Channel {
        id: entity.entity_id.to_string(),
        name: common.channel_name.clone(),
        channel_type: common.channel_type,
    })
}

fn document(entity: &Entity<'_>, sub_type: Option<&NotificationDocumentSubType>) -> Option<Place> {
    (entity.entity_type == EntityType::Document).then(|| Place::Document {
        id: entity.entity_id.to_string(),
        is_task: sub_type == Some(&NotificationDocumentSubType::Task),
        placement: DocumentPlacement::default(),
    })
}

fn project(entity: &Entity<'_>) -> Option<Place> {
    (entity.entity_type == EntityType::Initiative).then(|| Place::Project {
        id: entity.entity_id.to_string(),
    })
}

impl StackRule {
    /// Whether every condition the rule sets holds for the notification.
    pub fn matches(&self, conversation: &Conversation) -> bool {
        let source_holds = self.sources.is_empty()
            || self
                .sources
                .iter()
                .any(|source| source.matches(&conversation.place));

        let channel_type_holds = self.channel_types.is_empty()
            || matches!(
                &conversation.place,
                Place::Channel { channel_type, .. } if self.channel_types.contains(channel_type)
            );

        let kind_holds = self.kinds.is_empty() || self.kinds.contains(&conversation.kind);

        let sender_holds = self.senders.is_empty()
            || conversation
                .sender
                .as_ref()
                .is_some_and(|sender| self.senders.contains(sender));

        source_holds && channel_type_holds && kind_holds && sender_holds
    }
}

impl StackSource {
    fn matches(&self, place: &Place) -> bool {
        match (self, place) {
            (Self::Channel { id }, Place::Channel { id: channel, .. }) => id == channel,
            (
                Self::ChannelNameContains { text },
                Place::Channel {
                    name, channel_type, ..
                },
            ) => {
                *channel_type != ChannelType::DirectMessage
                    && name.to_lowercase().contains(&text.to_lowercase())
            }
            (Self::Document { id }, Place::Document { id: document, .. }) => id == document,
            (Self::Folder { id }, Place::Document { placement, .. }) => {
                placement.folders.contains(id)
            }
            (Self::Project { id }, Place::Project { id: project }) => id == project,
            (Self::Project { id }, Place::Document { placement, .. }) => {
                placement.project.as_ref() == Some(id)
            }
            (
                Self::Channel { .. }
                | Self::ChannelNameContains { .. }
                | Self::Document { .. }
                | Self::Folder { .. }
                | Self::Project { .. },
                _,
            ) => false,
        }
    }

    /// Whether matching this source needs to know where a document is filed.
    pub fn needs_placement(&self) -> bool {
        matches!(self, Self::Folder { .. } | Self::Project { .. })
    }
}
