//! The registry of public event names.
//!
//! One registration drives the catalog endpoint, wildcard expansion and the
//! OpenAPI event union: an event a producer declares `Public` is delivered
//! only if its name is registered here, so a family becomes public by adding
//! its block (topic, payload type, events) to [`public_event_registry!`]
//! below, in one place.

#[cfg(test)]
mod test;

use activity::domain::events::{ActivityPublicEvent, ActivityTopicEvent};
use agent_session::domain::events::AgentSessionLifecycleEvent;
use bots::domain::events::{BotPublicEvent, BotTopicEvent};
use calendar_events::domain::events::{CalendarPublicEvent, CalendarTopicEvent};
use call::domain::events::{CallRecordPublicEvent, CallTopicEvent};
use call::domain::notification_events::CallNotificationEvent;
use channels::domain::broker_events::ChannelTopicEvent;
use channels::domain::mention_events::{MentionPublicEvent, MentionTopicEvent};
use chat::domain::events::{ChatPublicEvent, ChatTopicEvent};
use databases::domain::events::{DatabasePublicEvent, DatabaseTopicEvent};
use documents::domain::events::{DocumentPublicEvent, DocumentTopicEvent};
use email::domain::events::{EmailPublicEvent, EmailTopicEvent};
use event_exposure::Stage;
use forms::domain::events::{FormPublicEvent, FormTopicEvent};
use github::broker::{GithubWebhookPublicEvent, GithubWebhookTopicEvent};
use github_pull_requests::broker::{GithubPullRequestPublicEvent, GithubPullRequestTopicEvent};
use initiative::domain::events::{InitiativePublicEvent, InitiativeTopicEvent};
use messages::outbound::broker::MessageTopicEvent;
use notification::domain::models::websocket_notification_event::{
    NotificationPublicEvent, NotificationTopicEvent,
};
use projects::domain::events::{ProjectPublicEvent, ProjectTopicEvent};
use properties::domain::events::{PropertyPublicEvent, PropertyTopicEvent};
use serde::Serialize;
use teams::domain::events::{TeamPublicEvent, TeamTopicEvent};
use user_events::UserTopicEvent;

/// The class of rule that decides who receives an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum AudienceClass {
    /// Explicit accessors of the entity.
    Entity,
    /// Explicit accessors at or above an access level (such as editors).
    EntityAtLeast,
    /// One addressed user.
    Recipient,
    /// The owning user.
    Owner,
    /// Members of a team.
    Team,
    /// Admins and owners of a team.
    TeamAdmins,
    /// Members of every team a user belongs to.
    TeamsOf,
    /// A user and their contacts.
    ContactsOf,
    /// One webhook workspace.
    Workspace,
    /// People captured by the producer, such as removed participants.
    Snapshot,
    /// Claimants of a GitHub App installation.
    GithubInstallation,
}

impl AudienceClass {
    /// Whether this class carries a user's personal data, which bots see only
    /// for their owner and account managers see like the user.
    pub fn is_personal(self) -> bool {
        matches!(self, Self::Owner | Self::Recipient)
    }
}

/// One registered public event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct CatalogEntry {
    /// The public event name.
    pub name: &'static str,
    /// The public entity types its `entity_type` can be.
    pub entity_types: &'static [&'static str],
    /// The rule classes that can admit a subscriber.
    pub audience: &'static [AudienceClass],
    /// Rollout stage: `preview` events need the `public-event-stream` flag.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub stage: Stage,
}

/// Declares the public event registry: the catalog of every public event
/// and the OpenAPI union of the public payload types (`WebhookEvent`, from
/// which the SDK generates its event types).
///
/// A family listed in the union names its topic enum and its public payload
/// type (the topic's `TopicEvent::PublicPayload`, checked at compile time),
/// then its events. Families delivered but kept out of the SDK union (the
/// agent-runtime contract, webhook management) list only their events.
macro_rules! public_event_registry {
    (
        union {
            $(
                $(#[$doc:meta])*
                $variant:ident($topic:ty => $payload:ty) {
                    $( $name:literal: [$($entity_type:literal),+], [$($class:ident),+], $stage:ident; )+
                }
            )+
        }
        outside_union {
            $( $oname:literal: [$($oentity_type:literal),+], [$($oclass:ident),+], $ostage:ident; )*
        }
    ) => {
        /// Every public event, family by family, in topic declaration order.
        pub const CATALOG: &[CatalogEntry] = &[
            $( $(
                CatalogEntry {
                    name: $name,
                    entity_types: &[$($entity_type),+],
                    audience: &[$(AudienceClass::$class),+],
                    stage: Stage::$stage,
                },
            )+ )+
            $(
                CatalogEntry {
                    name: $oname,
                    entity_types: &[$($oentity_type),+],
                    audience: &[$(AudienceClass::$oclass),+],
                    stage: Stage::$ostage,
                },
            )*
        ];

        /// Any public event deliverable by webhook or stream, as its payload
        /// (`event_type` and `metadata`); delivered inside the broker
        /// envelope. Endpoint validation additionally sends a
        /// `WebhookValidationTestEvent`, which is not part of this union, and
        /// `webhook.*` and `agent_trigger.*` are delivered outside it.
        #[cfg(feature = "schema")]
        #[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
        #[serde(untagged)]
        pub enum WebhookEvent {
            $( $(#[$doc])* $variant($payload), )+
        }

        // Each union member is its topic's declared public payload.
        const _: () = {
            const fn is_public_payload<T: macro_event_broker::TopicEvent<PublicPayload = P>, P>() {}
            $( is_public_payload::<$topic, $payload>(); )+
        };

        /// Each union family's name and the events registered under it.
        #[cfg(test)]
        const UNION_FAMILIES: &[(&str, &[&str])] = &[
            $( (stringify!($variant), &[$($name),+]), )+
        ];

        /// Runs `visitor` with the topic enum of the union family named
        /// `family`, so tests can decode that family's broker events.
        #[cfg(test)]
        fn visit_union_family<V: test::TopicVisitor>(family: &str, visitor: V) -> Option<V::Output> {
            match family {
                $( stringify!($variant) => Some(visitor.visit::<$topic>()), )+
                _ => None,
            }
        }
    };
}

public_event_registry! {
    union {
        /// Document lifecycle events from the `macro.documents` topic.
        Document(DocumentTopicEvent => DocumentPublicEvent) {
            "document.created": ["document"], [Entity], Stable;
            "document.updated": ["document"], [Entity], Stable;
            "document.deleted": ["document"], [Entity], Stable;
            "document.copied": ["document"], [Entity], Stable;
            "document.interaction": ["document"], [Entity], Stable;
            "document.content_changed": ["document"], [Entity], Preview;
            "document.appearance_changed": ["document"], [Entity], Preview;
        }
        /// Channel lifecycle events from the `macro.channels` topic.
        Channel(ChannelTopicEvent => ChannelTopicEvent) {
            "channel.created": ["channel"], [Entity], Stable;
            "channel.updated": ["channel"], [Entity], Stable;
            "channel.picture_changed": ["channel"], [Entity], Stable;
            "channel.deleted": ["channel"], [Entity, Snapshot], Stable;
            "channel.participant_added": ["channel"], [Entity], Stable;
            "channel.participant_removed": ["channel"], [Entity], Stable;
            "channel.access_requested": ["channel"], [Entity], Stable;
        }
        /// Access-checked call notifications from `macro.call_notifications`.
        Call(CallNotificationEvent => CallNotificationEvent) {
            "call.started": ["call"], [Entity], Stable;
            "call.ended": ["call"], [Entity], Stable;
            "call.participant_joined": ["call"], [Entity], Stable;
            "call.participant_left": ["call"], [Entity], Stable;
            "call.recording_ready": ["call"], [Entity], Stable;
            "call.summarized": ["call"], [Entity], Stable;
            "call.ringing": ["call"], [Recipient], Stable;
            "call.answered": ["call"], [Recipient], Stable;
            "call.declined": ["call"], [Recipient], Stable;
            "call.invited": ["call"], [Recipient], Stable;
        }
        /// Message facts for channels and documents from the `macro.messages` topic.
        Message(MessageTopicEvent => MessageTopicEvent) {
            "message.posted": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
            "message.patched": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
            "message.deleted": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
            "message.mentioned": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
            "message.attachment_created": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
            "message.attachment_removed": ["channel", "document", "initiative", "crm_company", "crm_contact", "call"], [Entity], Stable;
        }
        /// Agent session lifecycle events from the
        /// `macro.agent_session_lifecycle` topic.
        AgentSession(AgentSessionLifecycleEvent => AgentSessionLifecycleEvent) {
            "agent_session.opened": ["agent_session"], [Entity], Stable;
            "agent_session.turn_started": ["agent_session"], [Entity], Stable;
            "agent_session.turn_ended": ["agent_session"], [Entity], Stable;
            "agent_session.command_rejected": ["agent_session"], [Entity], Stable;
            "agent_session.settled": ["agent_session"], [Entity], Stable;
            "agent_session.waiting_for_input": ["agent_session"], [Entity], Stable;
            "agent_session.input_received": ["agent_session"], [Entity], Stable;
            "agent_session.mentioned": ["agent_session"], [Entity], Stable;
            "agent_session.stopped": ["agent_session"], [Entity], Stable;
            "agent_session.renamed": ["agent_session"], [Entity], Stable;
            "agent_session.deleted": ["agent_session"], [Owner, Entity], Stable;
        }
        /// User profile events from the `macro.users` topic.
        User(UserTopicEvent => UserTopicEvent) {
            "user.picture_changed": ["user"], [ContactsOf, TeamsOf], Stable;
        }
        /// Project lifecycle events from the `macro.projects` topic.
        Project(ProjectTopicEvent => ProjectPublicEvent) {
            "project.created": ["project"], [Entity], Preview;
            "project.updated": ["project"], [Entity], Preview;
            "project.deleted": ["project"], [Entity], Preview;
            "project.restored": ["project"], [Entity], Preview;
            "project.permanently_deleted": ["project"], [Owner], Preview;
            "project.uploaded": ["project"], [Entity], Preview;
        }
        /// AI chat events from the `macro.chats` topic.
        Chat(ChatTopicEvent => ChatPublicEvent) {
            "chat.created": ["chat"], [Entity], Preview;
            "chat.updated": ["chat"], [Entity], Preview;
            "chat.deleted": ["chat"], [Entity], Preview;
            "chat.restored": ["chat"], [Entity], Preview;
            "chat.copied": ["chat"], [Entity], Preview;
            "chat.message_sent": ["chat"], [Entity], Preview;
            "chat.message_deleted": ["chat"], [Entity], Preview;
        }
        /// Database events from the `macro.databases` topic.
        Database(DatabaseTopicEvent => DatabasePublicEvent) {
            "database.created": ["database"], [Entity], Preview;
            "database.renamed": ["database"], [Entity], Preview;
            "database.trashed": ["database"], [Entity], Preview;
            "database.restored": ["database"], [Entity], Preview;
            "database.tables_changed": ["database"], [Entity], Preview;
            "database.sharing_changed": ["database"], [Entity], Preview;
            "database.appearance_changed": ["database"], [Entity], Preview;
        }
        /// Form events from the `macro.forms` topic.
        Form(FormTopicEvent => FormPublicEvent) {
            "form.created": ["form"], [Entity], Preview;
            "form.renamed": ["form"], [Entity], Preview;
            "form.trashed": ["form"], [Entity], Preview;
            "form.restored": ["form"], [Entity], Preview;
            "form.sharing_changed": ["form"], [Entity], Preview;
            "form.response_submitted": ["form"], [EntityAtLeast], Preview;
            "form.appearance_changed": ["form"], [Entity], Preview;
        }
        /// Initiative events from the `macro.initiatives` topic.
        Initiative(InitiativeTopicEvent => InitiativePublicEvent) {
            "initiative.created": ["initiative"], [Entity], Preview;
            "initiative.updated": ["initiative"], [Entity], Preview;
            "initiative.appearance_changed": ["initiative"], [Entity], Preview;
            "initiative.purged": ["initiative"], [Snapshot], Preview;
        }
        /// Entity property values, property definitions and options from the
        /// `macro.properties` topic.
        Property(PropertyTopicEvent => PropertyPublicEvent) {
            "entity_property.updated": ["call", "channel", "chat", "crm_company", "crm_contact", "database_row", "document", "initiative", "project", "email_thread"], [Entity], Preview;
            "entity_properties.cleared": ["call", "channel", "chat", "crm_company", "crm_contact", "database_row", "document", "initiative", "project", "email_thread"], [Entity], Preview;
            "property.created": ["property"], [Recipient, Team, Entity], Preview;
            "property.deleted": ["property"], [Recipient, Team, Entity], Preview;
            "property_option.created": ["property"], [Recipient, Team, Entity], Preview;
            "property_option.updated": ["property"], [Recipient, Team, Entity], Preview;
            "property_option.deleted": ["property"], [Recipient, Team, Entity], Preview;
        }
        /// Call record events from the `macro.calls` topic.
        CallRecord(CallTopicEvent => CallRecordPublicEvent) {
            "call.record_updated": ["call"], [Entity], Preview;
            "call.record_deleted": ["call"], [Entity], Preview;
            "call.record_imported": ["call"], [Entity], Preview;
        }
        /// Pull request events from the `macro.github_pull_requests` topic.
        GithubPullRequest(GithubPullRequestTopicEvent => GithubPullRequestPublicEvent) {
            "github_pull_request.updated": ["github_pull_request"], [Entity], Preview;
        }
        /// The owner's mailbox events from the `macro.email` topic.
        Email(EmailTopicEvent => EmailPublicEvent) {
            "email.link_connected": ["email_link"], [Recipient], Preview;
            "email.link_disconnected": ["email_link"], [Recipient], Preview;
            "email.link_reauth_required": ["email_link"], [Recipient], Preview;
            "email.message_received": ["email_thread"], [Recipient], Preview;
            "email.message_sent": ["email_thread"], [Recipient], Preview;
            "email.message_deleted": ["email_thread"], [Recipient], Preview;
            "email.message_send_queued": ["email_thread"], [Recipient], Preview;
            "email.message_send_cancelled": ["email_thread"], [Recipient], Preview;
            "email.thread_archived": ["email_thread"], [Recipient], Preview;
            "email.thread_trashed": ["email_thread"], [Recipient], Preview;
            "email.thread_read": ["email_thread"], [Recipient], Preview;
            "email.thread_starred": ["email_thread"], [Recipient], Preview;
            "email.thread_spam_changed": ["email_thread"], [Recipient], Preview;
            "email.thread_project_changed": ["email_thread"], [Recipient], Preview;
            "email.thread_labels_updated": ["email_thread"], [Recipient], Preview;
        }
        /// The owner's calendar changes from the `macro.calendar` topic.
        Calendar(CalendarTopicEvent => CalendarPublicEvent) {
            "calendar_event.created": ["calendar_event"], [Recipient], Preview;
            "calendar_event.updated": ["calendar_event"], [Recipient], Preview;
            "calendar_event.deleted": ["calendar_event"], [Recipient], Preview;
        }
        /// A user's activity feed from the `macro.activity` topic.
        Activity(ActivityTopicEvent => ActivityPublicEvent) {
            "activity.recorded": ["user"], [Recipient], Preview;
        }
        /// A user's notifications from the `macro.notifications` topic.
        Notification(NotificationTopicEvent<'static, serde_json::Value> => NotificationPublicEvent) {
            "notification.created": ["notification"], [Recipient], Preview;
            "notification.updated": ["notification"], [Recipient], Preview;
        }
        /// Entity mentions in documents from the `macro.mentions` topic.
        Mention(MentionTopicEvent => MentionPublicEvent) {
            "mention.created": ["document"], [Entity], Preview;
            "mention.deleted": ["document"], [Entity], Preview;
        }
        /// Team events from the `macro.teams` topic.
        Team(TeamTopicEvent => TeamPublicEvent) {
            "team.created": ["team"], [Team], Preview;
            "team.updated": ["team"], [Team], Preview;
            "team.deleted": ["team"], [Snapshot], Preview;
            "team.invite_created": ["team"], [TeamAdmins], Preview;
            "team.invite_rejected": ["team"], [TeamAdmins], Preview;
            "team.invite_revoked": ["team"], [TeamAdmins], Preview;
            "team.member_joined": ["team"], [Team], Preview;
            "team.member_removed": ["team"], [Team, Snapshot], Preview;
            "team.member_role_changed": ["team"], [Team], Preview;
            "team.auto_join_domain_toggled": ["team"], [TeamAdmins], Preview;
        }
        /// Bot lifecycle from the `macro.bots` topic, for the owning user or team.
        Bot(BotTopicEvent => BotPublicEvent) {
            "bot.created": ["bot"], [Recipient, Team], Preview;
            "bot.updated": ["bot"], [Recipient, Team], Preview;
            "bot.deleted": ["bot"], [Recipient, Team], Preview;
        }
        /// GitHub App deliveries from the `macro.github_webhooks` topic.
        GithubWebhook(GithubWebhookTopicEvent => GithubWebhookPublicEvent) {
            "github_webhook.received": ["github_installation"], [GithubInstallation], Preview;
        }
    }
    outside_union {
        // macro.webhooks: webhook management, for the owning workspace.
        "webhook.created": ["webhook"], [Workspace], Stable;
        "webhook.updated": ["webhook"], [Workspace], Stable;
        "webhook.deleted": ["webhook"], [Workspace], Stable;
        "webhook.validated": ["webhook"], [Workspace], Stable;
        // macro.agent_sessions: the agent-runtime contract.
        "agent_trigger.new": ["bot"], [Entity, Owner], Stable;
        "agent_trigger.existing": ["bot"], [Entity], Stable;
    }
}

/// Families an account manager's key never receives: webhook, bot and API
/// key lifecycle belong to the account holder.
pub const ACCOUNT_HOLDER_FAMILIES: &[&str] = &["webhook", "bot", "api_key"];

/// The registered entry for a public event name.
pub fn entry(name: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.name == name)
}

/// Whether `name` is a registered public event.
pub fn is_public_event(name: &str) -> bool {
    entry(name).is_some()
}

/// The catalog entries a stream held by `principal` can receive: preview
/// entries only with the flag, account-holder families only for the account
/// holder, and no purely personal events for a bot its acting user does not
/// own.
pub fn visible_to(
    principal: &crate::domain::models::StreamPrincipal,
    preview: bool,
) -> Vec<&'static CatalogEntry> {
    CATALOG
        .iter()
        .filter(|entry| preview || entry.stage == Stage::Stable)
        .filter(|entry| {
            principal.kind.is_account_holder()
                || !crate::domain::filters::family(entry.name)
                    .is_some_and(|family| ACCOUNT_HOLDER_FAMILIES.contains(&family))
        })
        .filter(|entry| {
            principal.kind.sees_personal_events()
                || !entry.audience.iter().all(|class| class.is_personal())
        })
        .collect()
}
