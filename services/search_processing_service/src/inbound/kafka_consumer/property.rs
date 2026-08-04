//! Maps property lifecycle events to search-index actions and processes them.

use macro_event_broker::MacroEvent as _;
use models_properties::EntityType;
use opensearch_client::OpensearchClient;
use properties::domain::events::{PropertyMacroEvent, PropertyTopicEvent};
use sqlx::PgPool;

use super::{EventOutcome, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY, retry_processing};
use crate::process::properties::process_entity_property_update;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PropertyIndexAction<'a> {
    Reindex {
        entity_id: &'a str,
        entity_type: EntityType,
    },
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PropertyEventDescription<'a> {
    pub(super) action: PropertyIndexAction<'a>,
    pub(super) event_type: &'static str,
}

pub(super) fn describe_property_event(event: &PropertyTopicEvent) -> PropertyEventDescription<'_> {
    match event {
        PropertyTopicEvent::Created(_) => PropertyEventDescription {
            action: PropertyIndexAction::Ignore,
            event_type: "property.created",
        },
        PropertyTopicEvent::Deleted(_) => PropertyEventDescription {
            action: PropertyIndexAction::Ignore,
            event_type: "property.deleted",
        },
        PropertyTopicEvent::OptionCreated(_) => PropertyEventDescription {
            action: PropertyIndexAction::Ignore,
            event_type: "property_option.created",
        },
        PropertyTopicEvent::OptionUpdated(_) => PropertyEventDescription {
            action: PropertyIndexAction::Ignore,
            event_type: "property_option.updated",
        },
        PropertyTopicEvent::OptionDeleted(_) => PropertyEventDescription {
            action: PropertyIndexAction::Ignore,
            event_type: "property_option.deleted",
        },
        PropertyTopicEvent::EntityPropertyUpdated(metadata) => PropertyEventDescription {
            action: PropertyIndexAction::Reindex {
                entity_id: &metadata.entity_id,
                entity_type: metadata.entity_type,
            },
            event_type: "entity_property.updated",
        },
        PropertyTopicEvent::EntityPropertyDeleted(metadata) => PropertyEventDescription {
            action: PropertyIndexAction::Reindex {
                entity_id: &metadata.entity_id,
                entity_type: metadata.entity_type,
            },
            event_type: "entity_property.deleted",
        },
        PropertyTopicEvent::EntityPropertiesCleared(metadata) => PropertyEventDescription {
            action: PropertyIndexAction::Reindex {
                entity_id: &metadata.entity_id,
                entity_type: metadata.entity_type,
            },
            event_type: "entity_properties.cleared",
        },
    }
}

pub(super) async fn process_property_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &PropertyMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_property_event(&event.event().event);
    let PropertyIndexAction::Reindex {
        entity_id,
        entity_type,
    } = description.action
    else {
        tracing::trace!(
            event_type = description.event_type,
            partition,
            offset,
            "ignoring property event without a search-index action"
        );
        return EventOutcome::Ignored;
    };

    let result = retry_processing(|attempt| async move {
        tracing::trace!(
            entity_id,
            entity_type = %entity_type,
            event_type = description.event_type,
            partition,
            offset,
            attempt,
            "processing property search-index event"
        );
        process_entity_property_update(opensearch_client, db, entity_id, entity_type)
            .await
            .inspect_err(|error| {
                if attempt < MAX_PROCESSING_ATTEMPTS {
                    let retry_delay =
                        PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                    tracing::warn!(
                        error = ?error,
                        entity_id,
                        entity_type = %entity_type,
                        event_type = description.event_type,
                        partition,
                        offset,
                        attempt,
                        delay_secs = retry_delay.as_secs(),
                        "property search-index processing failed, retrying"
                    );
                }
            })
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                entity_id,
                entity_type = %entity_type,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping property event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
