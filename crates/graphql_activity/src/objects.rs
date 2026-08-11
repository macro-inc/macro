use activity::{Action, ActivityRecord, RecordedAction};
use async_graphql::{ID, Json, SimpleObject, Union};
use graphql_common::GraphqlEntityType;
use serde_json::Value;

#[cfg(test)]
mod test;

/// One activity: a principal did something to an entity at a time.
///
/// Carries an entity *reference* only (`entityType`/`entityId`) — clients
/// resolve names and metadata from their normalized Soup cache.
#[derive(SimpleObject)]
pub struct GraphqlActivityEvent {
    /// The activity's stable identifier.
    pub id: ID,
    /// The principal that mechanically acted, as a prefix-parseable string
    /// (`macro|<email>` for users, `bot|<uuid>` for bots).
    pub actor_id: String,
    /// Whose activity this is: the delegating user when the actor acted on
    /// someone's behalf, otherwise the actor itself.
    pub subject_id: String,
    /// The kind of entity acted on.
    pub entity_type: GraphqlEntityType,
    /// The entity acted on.
    pub entity_id: ID,
    /// What the principal did.
    pub action: GraphqlActivityAction,
    /// When it happened, in RFC 3339 format.
    pub occurred_at: String,
}

impl From<ActivityRecord> for GraphqlActivityEvent {
    fn from(record: ActivityRecord) -> Self {
        Self {
            id: ID(record.id.to_string()),
            actor_id: record.actor.as_ref().to_owned(),
            subject_id: record.subject_id,
            entity_type: GraphqlEntityType::new(record.entity_type),
            entity_id: ID(record.entity_id),
            action: record.action.into(),
            occurred_at: record.occurred_at.to_rfc3339(),
        }
    }
}

/// The typed activity-action vocabulary. One member per durable action, plus
/// [`GraphqlActivityUnknownAction`]: rows written by a newer deployment (or
/// with an undecodable payload) surface with their raw tag and payload
/// instead of failing the page.
#[derive(Union)]
pub enum GraphqlActivityAction {
    /// The entity was created.
    Created(GraphqlActivityCreated),
    /// The entity's content or metadata was edited.
    Edited(GraphqlActivityEdited),
    /// The entity was opened by its subject.
    Opened(GraphqlActivityOpened),
    /// The entity was soft-deleted.
    Deleted(GraphqlActivityDeleted),
    /// A message was sent in the entity (channel or chat).
    Messaged(GraphqlActivityMessaged),
    /// An email message was sent on the thread.
    Sent(GraphqlActivitySent),
    /// A property value changed on the entity.
    PropertyChanged(GraphqlActivityPropertyChanged),
    /// A principal was added to the entity (channel membership).
    ParticipantAdded(GraphqlActivityParticipantAdded),
    /// A principal was removed from the entity (channel membership).
    ParticipantRemoved(GraphqlActivityParticipantRemoved),
    /// A call was started in the entity (channel).
    CallStarted(GraphqlActivityCallStarted),
    /// An action outside this deployment's vocabulary, carried through raw.
    Unknown(GraphqlActivityUnknownAction),
}

/// The entity was created.
#[derive(SimpleObject)]
pub struct GraphqlActivityCreated {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// The entity's content or metadata was edited.
#[derive(SimpleObject)]
pub struct GraphqlActivityEdited {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// The entity was opened by its subject.
#[derive(SimpleObject)]
pub struct GraphqlActivityOpened {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// The entity was soft-deleted.
#[derive(SimpleObject)]
pub struct GraphqlActivityDeleted {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// A message was sent in the entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityMessaged {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// An email message was sent on the thread.
#[derive(SimpleObject)]
pub struct GraphqlActivitySent {
    /// this object has nothing as a field but we need at least 1 field
    nothing: bool,
}

/// A property value changed on the entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityPropertyChanged {
    /// The property definition id.
    pub property: String,
    /// The previous value, when the source event carried it.
    pub from: Option<Json<Value>>,
    /// The new value; absent when the value was cleared.
    pub to: Option<Json<Value>>,
}

/// A principal was added to the entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityParticipantAdded {
    /// The added principal, as a prefix-parseable string.
    pub participant: String,
}

/// A principal was removed from the entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityParticipantRemoved {
    /// The removed principal, as a prefix-parseable string.
    pub participant: String,
}

/// A call was started in the entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityCallStarted {
    /// The started call.
    pub call_id: ID,
}

/// An action this deployment's vocabulary doesn't know.
#[derive(SimpleObject)]
pub struct GraphqlActivityUnknownAction {
    /// The stored action tag.
    pub tag: String,
    /// The stored action payload, verbatim.
    pub payload: Option<Json<Value>>,
}

impl From<RecordedAction> for GraphqlActivityAction {
    fn from(action: RecordedAction) -> Self {
        match action {
            RecordedAction::Known(Action::Created) => {
                Self::Created(GraphqlActivityCreated { nothing: false })
            }
            RecordedAction::Known(Action::Edited) => {
                Self::Edited(GraphqlActivityEdited { nothing: false })
            }
            RecordedAction::Known(Action::Opened) => {
                Self::Opened(GraphqlActivityOpened { nothing: false })
            }
            RecordedAction::Known(Action::Deleted) => {
                Self::Deleted(GraphqlActivityDeleted { nothing: false })
            }
            RecordedAction::Known(Action::Messaged) => {
                Self::Messaged(GraphqlActivityMessaged { nothing: false })
            }
            RecordedAction::Known(Action::Sent) => {
                Self::Sent(GraphqlActivitySent { nothing: false })
            }
            RecordedAction::Known(Action::PropertyChanged(change)) => {
                Self::PropertyChanged(GraphqlActivityPropertyChanged {
                    property: change.property,
                    from: change.from.map(Json),
                    to: change.to.map(Json),
                })
            }
            RecordedAction::Known(Action::ParticipantAdded(change)) => {
                Self::ParticipantAdded(GraphqlActivityParticipantAdded {
                    participant: change.participant.as_ref().to_owned(),
                })
            }
            RecordedAction::Known(Action::ParticipantRemoved(change)) => {
                Self::ParticipantRemoved(GraphqlActivityParticipantRemoved {
                    participant: change.participant.as_ref().to_owned(),
                })
            }
            RecordedAction::Known(Action::CallStarted(start)) => {
                Self::CallStarted(GraphqlActivityCallStarted {
                    call_id: ID(start.call_id),
                })
            }
            RecordedAction::Unknown { tag, payload } => {
                Self::Unknown(GraphqlActivityUnknownAction {
                    tag,
                    payload: payload.map(Json),
                })
            }
        }
    }
}
