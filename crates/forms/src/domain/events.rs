//! The durable `macro.forms` events other domains consume, activity among
//! them.

use activity::Actor;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroFormsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{DatabaseId, FormId, FormResponseId, RowId};

#[cfg(test)]
mod test;

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
    /// The signed-in respondent; `None` for an anonymous visitor or when
    /// the form hides respondents. The ledger still records them.
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
    /// Icon or color metadata changed without touching content recency.
    #[serde(rename = "form.appearance_changed")]
    AppearanceChanged {
        /// The form.
        form_id: FormId,
        /// The editor, when authenticated.
        attribution: Option<Attribution>,
        /// Previous and saved appearance.
        change: activity::AppearanceChange,
    },
}

/// Public payload of most `form.*` events: which form changed and who did
/// it. Read the form for its new state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicFormChange {
    /// The form.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub form_id: FormId,
    /// Who acted, when attributable.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user the actor acted for, when different from the actor.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl PublicFormChange {
    fn new(form_id: &FormId, attribution: Option<&Attribution>) -> Self {
        Self {
            form_id: *form_id,
            actor: attribution.map(|by| by.actor.clone()),
            on_behalf_of: attribution.and_then(|by| by.on_behalf_of.clone()),
        }
    }
}

/// Public payload of `form.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicFormCreated {
    /// The created form, with who created it.
    #[serde(flatten)]
    pub change: PublicFormChange,
    /// The database holding its responses.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub database_id: DatabaseId,
    /// When it was created.
    pub created_at: DateTime<Utc>,
}

/// Public payload of `form.response_submitted`: where the response is, not
/// what it says or who gave it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PublicFormResponseSubmitted {
    /// The form.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub form_id: FormId,
    /// The ledger entry.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub response_id: FormResponseId,
    /// The row holding the answers, when one was written.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub row_id: Option<RowId>,
    /// When it was submitted.
    pub submitted_at: DateTime<Utc>,
}

/// The public projection of [`FormTopicEvent`], delivered under the same
/// event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum FormPublicEvent {
    /// A form was created.
    #[serde(rename = "form.created")]
    Created(PublicFormCreated),
    /// A form was renamed.
    #[serde(rename = "form.renamed")]
    Renamed(PublicFormChange),
    /// A form was moved to the trash.
    #[serde(rename = "form.trashed")]
    Trashed(PublicFormChange),
    /// A trashed form was restored.
    #[serde(rename = "form.restored")]
    Restored(PublicFormChange),
    /// Who the form is shared with changed.
    #[serde(rename = "form.sharing_changed")]
    SharingChanged(PublicFormChange),
    /// Someone responded; delivered to the form's editors only.
    #[serde(rename = "form.response_submitted")]
    ResponseSubmitted(PublicFormResponseSubmitted),
    /// The form's icon or color changed.
    #[serde(rename = "form.appearance_changed")]
    AppearanceChanged(PublicFormChange),
}

impl TopicEvent for FormTopicEvent {
    type Topic = MacroFormsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = FormPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, MinAccessLevel, PendingPhase, PublicEvent,
            Stage,
        };
        use std::borrow::Cow;

        let (name, form_id, min_level, payload) = match self {
            Self::Created(metadata) => (
                "form.created",
                &metadata.form_id,
                None,
                FormPublicEvent::Created(PublicFormCreated {
                    change: PublicFormChange::new(&metadata.form_id, Some(&metadata.attribution)),
                    database_id: metadata.database_id,
                    created_at: metadata.created_at,
                }),
            ),
            Self::Renamed(metadata) => (
                "form.renamed",
                &metadata.form_id,
                None,
                FormPublicEvent::Renamed(PublicFormChange::new(
                    &metadata.form_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::Trashed(metadata) => (
                "form.trashed",
                &metadata.form_id,
                None,
                FormPublicEvent::Trashed(PublicFormChange::new(
                    &metadata.form_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::Restored(metadata) => (
                "form.restored",
                &metadata.form_id,
                None,
                FormPublicEvent::Restored(PublicFormChange::new(
                    &metadata.form_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::SharingChanged(metadata) => (
                "form.sharing_changed",
                &metadata.form_id,
                None,
                FormPublicEvent::SharingChanged(PublicFormChange::new(
                    &metadata.form_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            // Responses are for the people who manage the form, not every
            // viewer of it.
            Self::ResponseSubmitted(metadata) => (
                "form.response_submitted",
                &metadata.form_id,
                Some(MinAccessLevel::Edit),
                FormPublicEvent::ResponseSubmitted(PublicFormResponseSubmitted {
                    form_id: metadata.form_id,
                    response_id: metadata.response_id,
                    row_id: metadata.row_id,
                    submitted_at: metadata.submitted_at,
                }),
            ),
            Self::AppearanceChanged {
                form_id,
                attribution,
                ..
            } => (
                "form.appearance_changed",
                form_id,
                None,
                FormPublicEvent::AppearanceChanged(PublicFormChange::new(
                    form_id,
                    attribution.as_ref(),
                )),
            ),
            Self::Purged(_) => {
                return Ok(Exposure::pending(
                    PendingPhase::ProducerChange,
                    "carries only the form id and its grants are gone when consumed; needs Owner plus an audience snapshot",
                ));
            }
        };
        let form_id = form_id.to_string();
        let audience = match min_level {
            Some(min_level) => Audience::EntityAtLeast {
                entity_type: EntityType::Form,
                entity_id: form_id.clone(),
                min_level,
            },
            None => Audience::Entity {
                entity_type: EntityType::Form,
                entity_id: form_id.clone(),
            },
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Form, form_id),
            audience,
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
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
            FormTopicEvent::AppearanceChanged { form_id, .. } => *form_id,
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
