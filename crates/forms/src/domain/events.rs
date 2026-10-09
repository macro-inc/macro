//! The durable `macro.forms` events other domains consume, activity among
//! them.

use activity::Actor;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroFormsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{DatabaseId, FormId, FormResponseId, RowId};

/// Who performed a change: the principal that mechanically acted and, when a
/// bot acted for a user, the user whose feed the action belongs on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attribution {
    /// Who mechanically acted.
    pub actor: Actor<'static>,
    /// The user the actor acted for, when different from the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl Attribution {
    /// A user acting for themselves.
    pub fn user(user: MacroUserIdStr<'static>) -> Self {
        Self {
            actor: Actor::new_from_user(user),
            on_behalf_of: None,
        }
    }

    /// `user` acting, or `bot` acting for them.
    pub fn acting(user: MacroUserIdStr<'static>, bot: Option<bot_id::BotId>) -> Self {
        match bot {
            Some(bot) => Self {
                actor: Actor::new_from_bot(bot),
                on_behalf_of: Some(user),
            },
            None => Self::user(user),
        }
    }
}

/// Metadata for [`FormTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormCreatedMetadata {
    /// The new form.
    pub form_id: FormId,
    /// The database holding its responses.
    pub database_id: DatabaseId,
    /// Its owner.
    pub owner: MacroUserIdStr<'static>,
    /// Its name.
    pub name: String,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// Who created it.
    pub attribution: Attribution,
}

/// Metadata for [`FormTopicEvent::Renamed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormRenamedMetadata {
    /// The form.
    pub form_id: FormId,
    /// Who renamed it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    /// Its new name.
    pub name: String,
}

/// Metadata for the lifecycle events that name only the form and who acted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormChangedMetadata {
    /// The form.
    pub form_id: FormId,
    /// Who acted; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// Metadata for [`FormTopicEvent::Purged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormPurgedMetadata {
    /// The form.
    pub form_id: FormId,
}

/// Metadata for [`FormTopicEvent::ResponseSubmitted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormResponseSubmittedMetadata {
    /// The form.
    pub form_id: FormId,
    /// The ledger entry.
    pub response_id: FormResponseId,
    /// The signed-in respondent; `None` for an anonymous one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub respondent: Option<MacroUserIdStr<'static>>,
    /// The row holding the answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_id: Option<RowId>,
    /// When it was submitted.
    pub submitted_at: DateTime<Utc>,
}

/// Events that can be published to [`MacroFormsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum FormTopicEvent {
    /// A form was created.
    #[serde(rename = "form.created")]
    Created(FormCreatedMetadata),
    /// A form's name changed.
    #[serde(rename = "form.renamed")]
    Renamed(FormRenamedMetadata),
    /// A form was moved to the trash.
    #[serde(rename = "form.trashed")]
    Trashed(FormChangedMetadata),
    /// A trashed form was brought back.
    #[serde(rename = "form.restored")]
    Restored(FormChangedMetadata),
    /// A form and its ledger were permanently deleted.
    #[serde(rename = "form.purged")]
    Purged(FormPurgedMetadata),
    /// Who the form is shared with changed.
    #[serde(rename = "form.sharing_changed")]
    SharingChanged(FormChangedMetadata),
    /// Someone responded.
    #[serde(rename = "form.response_submitted")]
    ResponseSubmitted(FormResponseSubmittedMetadata),
}

impl TopicEvent for FormTopicEvent {
    type Topic = MacroFormsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroFormsTopic`], keyed by form id.
pub struct FormMacroEvent {
    key: String,
    event: Event<FormTopicEvent>,
}

impl FormMacroEvent {
    /// Build an event keyed by the form it is about.
    pub fn new(event: FormTopicEvent) -> Self {
        Self::with_event(event.form_id().to_string(), Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<FormTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl FormTopicEvent {
    /// The form the event is about.
    pub fn form_id(&self) -> FormId {
        match self {
            FormTopicEvent::Created(metadata) => metadata.form_id,
            FormTopicEvent::Renamed(metadata) => metadata.form_id,
            FormTopicEvent::Trashed(metadata)
            | FormTopicEvent::Restored(metadata)
            | FormTopicEvent::SharingChanged(metadata) => metadata.form_id,
            FormTopicEvent::Purged(metadata) => metadata.form_id,
            FormTopicEvent::ResponseSubmitted(metadata) => metadata.form_id,
        }
    }
}

impl MacroEvent for FormMacroEvent {
    type EventPayload = FormTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
