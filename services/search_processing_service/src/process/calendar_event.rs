use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    upsert::{calendar_event::UpsertCalendarEventArgs, properties::IndexedProperty},
};
use properties::outbound::entity_properties_get_query::get_entity_properties_for_index;
use sqs_client::search::calendar_event::UpsertCalendarEvent;

/// Fetch the event's indexed properties, flattened for the search index.
async fn fetch_indexed_properties(
    db: &sqlx::Pool<sqlx::Postgres>,
    event_id: &str,
) -> anyhow::Result<Vec<IndexedProperty>> {
    let properties = get_entity_properties_for_index(db, event_id, EntityType::CalendarEvent)
        .await
        .context("failed to fetch calendar event properties for search index")?;
    Ok(properties
        .into_iter()
        .map(|p| IndexedProperty {
            definition_id: p.definition_id,
            values: p.values,
            number_value: p.number_value,
            date_value: p.date_value,
        })
        .collect())
}

/// Handles upserting a calendar event series master into the opensearch index.
///
/// Re-reads the event row so the indexed doc always reflects current state; a
/// missing row turns the upsert into a removal. Only the master is indexed —
/// recurring instances are materialized inside a rolling window, so search
/// resolves the relevant occurrence at query time instead.
#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn upsert_calendar_event(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    message: &UpsertCalendarEvent,
) -> anyhow::Result<()> {
    let index_override = message.index_override.as_deref();

    let event_id = uuid::Uuid::parse_str(&message.event_id)
        .context("calendar event id is not a valid uuid")?;

    let event = macro_db_client::calendar_event::get_event_for_index::get_calendar_event_for_index(
        db, event_id,
    )
    .await
    .context("failed to get calendar event for search")?;

    let Some(event) = event else {
        tracing::trace!("calendar event row is gone, removing from search index");
        opensearch_client
            .delete_calendar_event(&message.event_id, index_override)
            .await
            .context("failed to delete missing calendar event from search")?;
        return Ok(());
    };

    let properties = fetch_indexed_properties(db, &message.event_id).await?;

    let starts_at_millis = event
        .starts_at
        .map(|t| EpochMillis::new(t.timestamp_millis()))
        .transpose()?;
    let ends_at_millis = event
        .ends_at
        .map(|t| EpochMillis::new(t.timestamp_millis()))
        .transpose()?;

    opensearch_client
        .upsert_calendar_event(
            &UpsertCalendarEventArgs {
                event_id: event.id.to_string(),
                title: event.title,
                owner_id: event.owner_id,
                source_link_id: event.source_link_id.to_string(),
                ical_uid: event.ical_uid,
                status: event.status,
                is_recurring: event.is_recurring,
                starts_at_millis,
                ends_at_millis,
                start_date: event.start_date.map(|d| d.to_string()),
                end_date: event.end_date.map(|d| d.to_string()),
                organizer_email: event.organizer_email,
                attendee_emails: event.attendee_emails,
                created_at_millis: EpochMillis::new(event.created_at.timestamp_millis())?,
                updated_at_millis: EpochMillis::new(event.updated_at.timestamp_millis())?,
                properties,
            },
            index_override,
        )
        .await
        .context("failed to upsert calendar event")?;

    Ok(())
}

/// Removes a calendar event from the opensearch index.
///
/// Used when the topic reports a deletion: the row is already gone, so there
/// is nothing to re-read and reindexing would only spend a query learning that.
#[tracing::instrument(skip(opensearch_client), err)]
pub async fn remove_calendar_event(
    opensearch_client: &OpensearchClient,
    event_id: &str,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_calendar_event(event_id, index_override)
        .await
        .context("failed to delete calendar event from search")?;
    Ok(())
}
