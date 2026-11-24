//! `macro.databases` events reconcile the database rows index from Postgres.

use databases::domain::events::{DatabaseMacroEvent, DatabaseTopicEvent};
use macro_event_broker::MacroEvent as _;
use uuid::Uuid;

use super::{Attempted, Attempts, KafkaProcessingContext};
use crate::domain::database_row_index::{PassKind, TableSelection};

/// What a database event asks of the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DatabaseEventDescription {
    /// `None` when the event changes nothing the index holds.
    pub(super) pass: Option<(Uuid, TableSelection, PassKind)>,
    pub(super) event_type: &'static str,
}

/// Each pass rereads Postgres, so it does not matter what the event says
/// beyond which database and tables to look at. A created database is read
/// whole: duplicates and starter data write rows without a tables event.
pub(super) fn describe_database_event(event: &DatabaseTopicEvent) -> DatabaseEventDescription {
    match event {
        DatabaseTopicEvent::Created(metadata) => DatabaseEventDescription {
            pass: Some((
                metadata.database_id.into_uuid(),
                TableSelection::All,
                PassKind::CatchUp,
            )),
            event_type: "database.created",
        },
        DatabaseTopicEvent::TablesChanged(metadata) => DatabaseEventDescription {
            pass: Some((
                metadata.database_id.into_uuid(),
                TableSelection::Tables(
                    metadata
                        .tables
                        .iter()
                        .map(|table| table.table_id.into_uuid())
                        .collect(),
                ),
                PassKind::CatchUp,
            )),
            event_type: "database.tables_changed",
        },
        DatabaseTopicEvent::Trashed(metadata) => DatabaseEventDescription {
            pass: Some((
                metadata.database_id.into_uuid(),
                TableSelection::All,
                PassKind::CatchUp,
            )),
            event_type: "database.trashed",
        },
        DatabaseTopicEvent::Restored(metadata) => DatabaseEventDescription {
            // A watermark a pass raised just before the trash would read
            // as up to date; a restore rereads every row.
            pass: Some((
                metadata.database_id.into_uuid(),
                TableSelection::All,
                PassKind::Full,
            )),
            event_type: "database.restored",
        },
        DatabaseTopicEvent::Purged(metadata) => DatabaseEventDescription {
            pass: Some((
                metadata.database_id.into_uuid(),
                TableSelection::All,
                PassKind::CatchUp,
            )),
            event_type: "database.purged",
        },
        // Names, sharing and appearance are not indexed; search checks
        // access from Postgres when it answers.
        DatabaseTopicEvent::Renamed(_) => DatabaseEventDescription {
            pass: None,
            event_type: "database.renamed",
        },
        DatabaseTopicEvent::SharingChanged(_) => DatabaseEventDescription {
            pass: None,
            event_type: "database.sharing_changed",
        },
        DatabaseTopicEvent::AppearanceChanged { .. } => DatabaseEventDescription {
            pass: None,
            event_type: "database.appearance_changed",
        },
    }
}

pub(super) fn changes_search_index(event: &DatabaseMacroEvent) -> bool {
    describe_database_event(&event.event().event).pass.is_some()
}

pub(super) async fn process_database_event(
    context: &KafkaProcessingContext,
    event: &DatabaseMacroEvent,
    attempts: &Attempts,
) -> Attempted {
    let Some((database_id, selection, kind)) = describe_database_event(&event.event().event).pass
    else {
        return Ok((super::Handled::Ignored, 0));
    };
    attempts
        .run(|_| {
            context.database_row_indexer.reconcile_database(
                database_id,
                selection.clone(),
                kind,
                None,
            )
        })
        .await
}

#[cfg(test)]
mod test;
