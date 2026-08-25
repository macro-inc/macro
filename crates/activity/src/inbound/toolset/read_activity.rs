use std::{collections::HashMap, num::NonZeroU32};

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ActivityToolContext;
use crate::domain::{
    models::{Action, ActivityRecord, RecordedAction},
    ports::{ActivityPropertyMetadata, ActivityReads},
};

const MAX_ACTIVITY_RESULTS: u32 = 100;

/// Tool: read the authenticated user's own activity in a time range.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadActivity",
    description = "Read actions attributed to the authenticated user within a time range, newest first. Use this for questions about what the user did, including actions an agent performed on their behalf. Property changes include propertyName/propertyType plus fromLabels/toLabels for resolved select and tag values; use those human-readable fields in the answer and never expose property or option ids. Do not use this for organization-wide updates or everything that happened to entities the user can access; use ListEntities for those. Returns at most 100 activities and reports when the result was truncated."
)]
pub struct ReadActivity {
    /// Inclusive start of the time range.
    #[schemars(description = "Inclusive start of the range as an RFC 3339 timestamp.")]
    pub from: DateTime<Utc>,
    /// Exclusive end of the time range.
    #[schemars(
        description = "Exclusive end of the range as an RFC 3339 timestamp. Must be after from."
    )]
    pub to: DateTime<Utc>,
}

impl ToolAnnotated for ReadActivity {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read activity");
}

/// One activity action returned to the AI.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ToolActivityAction {
    /// The entity was created.
    Created,
    /// The entity's content or metadata was edited.
    Edited,
    /// The entity was opened.
    Opened,
    /// The entity was soft-deleted.
    Deleted,
    /// A message was sent in the entity.
    Messaged,
    /// An email message was sent on the thread.
    Sent,
    /// A property value changed on the entity.
    PropertyChanged {
        /// The property definition id.
        property: String,
        /// The property definition's human-readable display name, when it is
        /// still visible to the caller.
        #[serde(skip_serializing_if = "Option::is_none")]
        property_name: Option<String>,
        /// The property's canonical data type, including `tag` for tag sets.
        #[serde(skip_serializing_if = "Option::is_none")]
        property_type: Option<String>,
        /// The previous value, when known.
        from: Option<Value>,
        /// Previous select/tag option ids resolved to display labels.
        #[serde(skip_serializing_if = "Option::is_none")]
        from_labels: Option<Vec<String>>,
        /// The new value, or `None` when cleared.
        to: Option<Value>,
        /// New select/tag option ids resolved to display labels.
        #[serde(skip_serializing_if = "Option::is_none")]
        to_labels: Option<Vec<String>>,
    },
    /// A principal was added to the entity.
    ParticipantAdded {
        /// The added principal.
        participant: String,
    },
    /// A principal was removed from the entity.
    ParticipantRemoved {
        /// The removed principal.
        participant: String,
    },
    /// A call was started in the entity.
    CallStarted {
        /// The started call's id.
        call_id: String,
    },
    /// An action outside this deployment's vocabulary.
    Unknown {
        /// The stored action tag.
        tag: String,
        /// The stored payload, verbatim.
        payload: Option<Value>,
    },
}

impl ToolActivityAction {
    fn from_recorded(
        action: RecordedAction,
        properties: &HashMap<String, ActivityPropertyMetadata>,
    ) -> Self {
        match action {
            RecordedAction::Known(Action::Created) => Self::Created,
            RecordedAction::Known(Action::Edited) => Self::Edited,
            RecordedAction::Known(Action::Opened) => Self::Opened,
            RecordedAction::Known(Action::Deleted) => Self::Deleted,
            RecordedAction::Known(Action::Messaged) => Self::Messaged,
            RecordedAction::Known(Action::Sent) => Self::Sent,
            RecordedAction::Known(Action::PropertyChanged(change)) => {
                let metadata = properties.get(&change.property);
                let from_labels = option_labels(change.from.as_ref(), metadata);
                let to_labels = option_labels(change.to.as_ref(), metadata);
                Self::PropertyChanged {
                    property: change.property,
                    property_name: metadata.map(|property| property.display_name.clone()),
                    property_type: metadata.map(|property| property.data_type.clone()),
                    from: change.from,
                    from_labels,
                    to: change.to,
                    to_labels,
                }
            }
            RecordedAction::Known(Action::ParticipantAdded(change)) => Self::ParticipantAdded {
                participant: change.participant.as_ref().to_owned(),
            },
            RecordedAction::Known(Action::ParticipantRemoved(change)) => Self::ParticipantRemoved {
                participant: change.participant.as_ref().to_owned(),
            },
            RecordedAction::Known(Action::CallStarted(start)) => Self::CallStarted {
                call_id: start.call_id,
            },
            RecordedAction::Unknown { tag, payload } => Self::Unknown { tag, payload },
        }
    }
}

fn option_labels(
    value: Option<&Value>,
    metadata: Option<&ActivityPropertyMetadata>,
) -> Option<Vec<String>> {
    let value = value?;
    let metadata = metadata?;
    if value.get("type").and_then(Value::as_str) != Some("SelectOption") {
        return None;
    }
    let labels: Vec<String> = value
        .get("value")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|id| metadata.option_labels.get(id).cloned())
        .collect();
    (!labels.is_empty()).then_some(labels)
}

/// One activity event returned by [`ReadActivity`].
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivityEvent {
    /// The principal that mechanically performed the action.
    pub actor_id: String,
    /// The kind of entity acted on.
    pub entity_type: String,
    /// The entity acted on.
    pub entity_id: String,
    /// What the principal did.
    pub action: ToolActivityAction,
    /// When the action occurred.
    pub occurred_at: DateTime<Utc>,
}

impl ToolActivityEvent {
    fn from_record(
        record: ActivityRecord,
        properties: &HashMap<String, ActivityPropertyMetadata>,
    ) -> Self {
        Self {
            actor_id: record.actor.as_ref().to_owned(),
            entity_type: record.entity_type.as_ref().to_owned(),
            entity_id: record.entity_id,
            action: ToolActivityAction::from_recorded(record.action, properties),
            occurred_at: record.occurred_at,
        }
    }
}

/// Response from [`ReadActivity`].
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadActivityResponse {
    /// Matching activity events, newest first.
    pub activities: Vec<ToolActivityEvent>,
    /// Whether more than 100 events matched the requested range.
    pub truncated: bool,
}

#[async_trait]
impl<R> AsyncTool<ActivityToolContext<R>> for ReadActivity
where
    R: ActivityReads + Send + Sync + 'static,
{
    type Output = ReadActivityResponse;

    #[tracing::instrument(
        skip_all,
        fields(from = ?self.from, to = ?self.to),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<ActivityToolContext<R>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.from >= self.to {
            return Err(ToolCallError {
                description: "activity range `from` must be before `to`".to_string(),
                internal_error: std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "invalid activity time range",
                )
                .into(),
            });
        }

        let range = service_context
            .service
            .subject_activity_range(
                &request_context.user_id,
                self.from,
                self.to,
                NonZeroU32::new(MAX_ACTIVITY_RESULTS).expect("activity result limit is non-zero"),
            )
            .await
            .map_err(|error| ToolCallError {
                description: "unable to read activity for the requested time range".to_string(),
                internal_error: error.into(),
            })?;

        let crate::domain::service::ResolvedActivityRange {
            activity,
            properties,
        } = range;
        Ok(ReadActivityResponse {
            activities: activity
                .records
                .into_iter()
                .map(|record| ToolActivityEvent::from_record(record, &properties))
                .collect(),
            truncated: activity.truncated,
        })
    }
}
