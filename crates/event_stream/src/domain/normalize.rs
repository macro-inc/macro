//! A broker event's public form, from its declared exposure.
//!
//! Shared by both deliveries: the public event log and persisted webhook
//! ingestion normalize through here, so they agree on which events are
//! public, what they are called, what they are about and what is delivered.

use crate::domain::catalog;
use crate::domain::models::{NormalizedEvent, PublicLogEvent};
use chrono::Utc;
use event_exposure::{Exposure, ExposureError};
use macro_event_broker::{Event, TopicEvent};

/// Why an event could not be normalized. Permanent: retrying cannot fix it.
#[derive(Debug, thiserror::Error)]
pub enum NormalizeError {
    /// The event violates the contract its exposure relies on.
    #[error(transparent)]
    Exposure(#[from] ExposureError),
    /// The event is declared public under a name the catalog does not list.
    #[error("public event `{0}` is not registered in the event catalog")]
    Unregistered(&'static str),
    /// The public payload could not be serialized.
    #[error("failed to serialize the public payload: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// The event's public form, or `None` when it is internal.
///
/// The delivered body is the broker envelope (`event_id`, `schema_version`,
/// routing ids when set) around the declared public payload, never the
/// internal metadata.
pub fn normalize<E: TopicEvent>(
    event: &Event<E>,
) -> Result<Option<PublicLogEvent>, NormalizeError> {
    let public = match event.event.exposure()? {
        Exposure::Internal(_) => return Ok(None),
        Exposure::Public(public) => public,
    };
    if !catalog::is_public_event(public.name) {
        return Err(NormalizeError::Unregistered(public.name));
    }

    let envelope = Event {
        event_id: event.event_id,
        agent_correlation_id: event.agent_correlation_id,
        routine_id: event.routine_id,
        agent_verb: event.agent_verb.clone(),
        schema_version: event.schema_version,
        event: public.payload.as_ref(),
    };
    let broker_envelope = serde_json::to_value(&envelope)?;
    let entity_id = public.entity.entity_id;

    Ok(Some(PublicLogEvent {
        event: NormalizedEvent {
            event_id: event.event_id.to_string(),
            schema_version: event.schema_version,
            event_name: public.name.to_owned(),
            entity_type: public.entity.entity_type.as_str().to_owned(),
            ordering_key: entity_id.clone(),
            entity_id,
            occurred_at: Utc::now(),
            broker_envelope,
        },
        audience: public.audience,
        stage: public.stage,
    }))
}
