//! Writing a data source as a database: its schema, rows, row bodies, and
//! relations once every database exists. Every step is recorded as it
//! completes, so a resumed write picks up where the last attempt stopped.

use std::collections::{HashMap, HashSet};

use crate::domain::models::{FidelityWarning, ImportNotice, ImportNoticeKind};
use futures::{FutureExt, StreamExt, stream};
use import_notion::domain::inventory::all_rows;
use import_notion::domain::macro_cells::{
    ColumnNames, ColumnPlan, ColumnShape, PeopleMap, capped_name, derived_id,
};
use import_notion::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionPropertyKind, NotionPropertySchema, NotionValue,
};
use import_notion::domain::ports::NotionApi;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, DatabaseId, DatabaseOp, EntityKind,
    EntityRef, NewColumn, OpResult, RowChange, RowChanges, RowId, RowsChange, RowsResult,
    TableChange, TableId,
};
use uuid::Uuid;

use super::{BODY_CONCURRENCY, Cancel, Progress, WriteItem, folder_once};
use crate::domain::models::{WrittenKind, WrittenObject};
use crate::domain::ports::{
    ImportVisibility, ImportedDocumentProperties, NewDatabase, NotionLinks, SharedEntity,
    SourceDates, WorkspaceWriter, WrittenObjects,
};

#[cfg(test)]
mod test;

mod prepare;
mod schema;
pub(in super::super) use prepare::{PreparedDatabase, prepare_database};

/// Rows per insert batch, well under the 10,000-row batch limit.
const ROWS_PER_BATCH: usize = 500;
/// Name of the column linking a database row to its page body.
const PAGE_COLUMN: &str = "Page";

/// One row of a written database, for linking relations afterwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in super::super) struct WrittenRow {
    /// The database.
    pub database: DatabaseId,
    /// Its table.
    pub table: TableId,
    /// The row.
    pub row: RowId,
}

/// A relation column waiting until every table exists.
#[derive(Debug, Clone, PartialEq)]
pub(in super::super) struct PendingRelation {
    /// The database holding the column.
    pub database: Uuid,
    /// Its table.
    pub table: TableId,
    /// The column name.
    pub name: String,
    /// The data source the relation points at.
    pub target: Option<NotionId>,
    /// Each written row's related Notion pages.
    pub links: Vec<(RowId, Vec<NotionId>)>,
}

/// What writing one data source produced.
#[derive(Debug, Clone, PartialEq, Default)]
pub(in super::super) struct WrittenDatabase {
    /// The ledger row it was written for.
    pub import_id: Uuid,
    /// The Macro database.
    pub database_id: Uuid,
    /// The data source's table in it.
    pub table: Option<TableId>,
    /// Notion row id → written row.
    pub rows: HashMap<NotionId, WrittenRow>,
    /// Relations to link once every table exists.
    pub relations: Vec<PendingRelation>,
    /// Relation columns an earlier attempt created, by name.
    pub relations_created: HashSet<String>,
    /// Relation columns an earlier attempt finished linking, by name.
    pub relations_linked: HashSet<String>,
}

/// Write one data source as a database: columns from its schema, every row,
/// each row's body as a linked document, and relations left pending. With
/// `share`, the database and its row bodies' folder are shared with the
/// team. What an earlier attempt wrote (per `progress`) is reused, not
/// written again.
#[expect(
    clippy::too_many_arguments,
    reason = "a database needs its source, destination, people, links and progress"
)]
#[cfg(test)]
pub(in super::super) async fn write_database<
    Api: NotionApi,
    Writer: WorkspaceWriter,
    Store: WrittenObjects,
>(
    api: &Api,
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    folder: Uuid,
    share: bool,
    people: &PeopleMap,
    links: &tokio::sync::RwLock<NotionLinks>,
    progress: &Progress<'_, Store>,
    cancel: &Cancel,
    personal_folder: Option<Uuid>,
) -> anyhow::Result<WrittenDatabase> {
    let prepared = prepare_database(api, writer, user, item, Some(folder), progress, cancel).await;
    progress.flush_warnings().await?;
    let prepared = prepared?;
    let destinations = HashMap::from([(
        item.notion_id.clone(),
        super::super::databases::DatabaseDestination::Ready(
            crate::domain::ports::ImportedDatabase {
                database_id: prepared.created.database_id,
                table: prepared.created.table,
                views: prepared.views.iter().copied().collect(),
            },
        ),
    )]);
    let result = write_prepared_database(
        api,
        writer,
        user,
        item,
        share,
        people,
        links,
        progress,
        cancel,
        &prepared,
        &destinations,
        personal_folder,
    )
    .await;
    progress.flush_warnings().await?;
    result
}

/// Fill a reserved database only after every source and saved view exists.
#[expect(
    clippy::too_many_arguments,
    reason = "the approved source, its destination and ledger progress"
)]
#[tracing::instrument(name = "notion.write_database", skip_all, fields(source_id = %item.notion_id, database_id = %prepared.created.database_id, rows_read_write = tracing::field::Empty, unmapped_people = tracing::field::Empty), err)]
pub(in super::super) async fn write_prepared_database<
    Api: NotionApi,
    Writer: WorkspaceWriter,
    Store: WrittenObjects,
>(
    api: &Api,
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    share: bool,
    people: &PeopleMap,
    links: &tokio::sync::RwLock<NotionLinks>,
    progress: &Progress<'_, Store>,
    cancel: &Cancel,
    prepared: &PreparedDatabase,
    destinations: &super::super::databases::DatabaseDestinations,
    personal_folder: Option<Uuid>,
) -> anyhow::Result<WrittenDatabase> {
    let PreparedDatabase {
        source,
        created,
        plan,
        folder,
        ..
    } = prepared;
    cancel.ensure_running()?;
    let current = api.data_source(&item.notion_id).await?;
    let mut losses = Vec::new();
    let notice = |kind| FidelityWarning::Notice {
        notice: ImportNotice::new(&item.notion_id, &item.title, kind),
    };
    let mut plan = plan.clone();
    for column in &mut plan.columns {
        if let Some(property) = current
            .properties
            .iter()
            .find(|property| property.id == column.property_id)
        {
            column.property = property.name.clone();
        }
    }
    for property in &source.properties {
        if !current.properties.iter().any(|now| now == property) {
            losses.push(notice(ImportNoticeKind::PropertyChanged {
                property: property.name.clone(),
            }));
        }
    }
    for property in &current.properties {
        if !source
            .properties
            .iter()
            .any(|before| before.id == property.id)
        {
            losses.push(notice(ImportNoticeKind::PropertyAdded {
                property: property.name.clone(),
            }));
        }
    }
    let drained = all_rows(api, &item.notion_id).await?;
    tracing::Span::current().record("rows_read_write", drained.rows_read as i64);
    if !drained.complete {
        losses.push(notice(ImportNoticeKind::WriteScanIncomplete));
    }
    let rows = &drained.rows;
    for column in &plan.columns {
        if column.shape == ColumnShape::Date
            && rows.iter().any(|row| {
                matches!(
                    row.properties.get(&column.property),
                    Some(NotionValue::Date { end: Some(_), .. })
                )
            })
        {
            losses.push(notice(ImportNoticeKind::DateEndDrift {
                property: column.property.clone(),
            }));
        }
    }
    progress.warn_fidelity(&losses).await?;
    if share {
        writer
            .share_with_team(user, SharedEntity::Database(created.database_id))
            .await?;
    }
    if share {
        for document in progress.all(WrittenKind::Body).values() {
            cancel.ensure_running()?;
            writer
                .share_with_team(user, SharedEntity::Document(*document))
                .await?;
        }
    }
    let table = created.table;
    let page_column = PageColumn {
        id: ColumnId::from_uuid(derived_id(created.database_id, "column/page")),
        name: page_column_name(&source.properties),
        order: std::iter::once(created.title_column)
            .chain(plan.columns.iter().map(|column| column.id))
            .collect(),
    };
    let database = DatabaseId::from_uuid(created.database_id);
    let mut written = WrittenDatabase {
        import_id: item.import_id,
        database_id: created.database_id,
        table: Some(table),
        rows: recorded_rows(progress, database, table),
        ..WrittenDatabase::default()
    };
    // Reservation can precede this phase by many sources. Recheck the actual
    // filed folder, not a newly resolved mirror, before adding personal rows.
    if !item.shared
        && let Some(folder) = folder
        && writer.folder_has_explicit_grant(user, *folder).await?
    {
        let reason = crate::domain::models::SourceStopReason::PersonalFolderShared;
        progress.source_stopped(&item.title, reason).await?;
        return Err(reason.into());
    }
    let unwritten: Vec<NotionPage> = rows
        .iter()
        .filter(|row| !written.rows.contains_key(&row.id))
        .cloned()
        .collect();
    let mut unmapped_people = 0u64;
    for batch in owned_batches(&unwritten) {
        cancel.ensure_running()?;
        for row in &batch {
            for column in &plan.columns {
                if !matches!(column.shape, ColumnShape::People { .. }) {
                    continue;
                }
                let Some(NotionValue::People(ids)) = row.properties.get(&column.property) else {
                    continue;
                };
                let missing = ids
                    .iter()
                    .filter(|id| {
                        people
                            .get(*id)
                            .is_none_or(|person| person.macro_user.is_none())
                    })
                    .collect::<HashSet<_>>()
                    .len();
                if missing > 0 {
                    unmapped_people =
                        unmapped_people.saturating_add(u64::try_from(missing).unwrap_or(u64::MAX));
                    tracing::Span::current().record("unmapped_people", unmapped_people);
                    progress.loss(crate::domain::models::SourceLossFact {
                        object: row.id.clone(),
                        detail: crate::domain::models::SourceLossDetail::UnmappedPeople {
                            source: item.title.clone(),
                            property_id: column.property_id.clone(),
                            property: column.property.clone(),
                            count: u32::try_from(missing).unwrap_or(u32::MAX),
                        },
                    })?;
                }
            }
            for loss in plan.option_losses(row) {
                progress.loss(crate::domain::models::SourceLossFact {
                    object: row.id.clone(),
                    detail: crate::domain::models::SourceLossDetail::Option {
                        property_id: loss.property_id,
                        property: loss.property,
                        option_id: loss.value.id,
                        option: loss.value.name,
                        matched_by: loss.matched_by,
                    },
                })?;
            }
        }
        let cells: Vec<Vec<CellWrite>> = batch
            .iter()
            .map(|row| plan.row_cells(row, created.title_column, people))
            .collect();
        let results = writer
            .apply_database_ops(
                user,
                created.database_id,
                vec![DatabaseOp::Rows {
                    table,
                    change: RowsChange::Insert {
                        rows: cells,
                        ids: None,
                    },
                }],
            )
            .await?;
        let ids = inserted_rows(&results);
        anyhow::ensure!(
            ids.len() == batch.len(),
            "database insert returned {} rows for {} written",
            ids.len(),
            batch.len()
        );
        progress
            .record_all(
                batch
                    .iter()
                    .zip(&ids)
                    .map(|(row, id)| {
                        let mut markers = progress.loss_markers(&row.id)?;
                        markers.push(WrittenObject::for_row(
                            item.import_id,
                            WrittenKind::Row,
                            &row.id,
                            id.into_uuid(),
                        ));
                        Ok(markers)
                    })
                    .collect::<anyhow::Result<Vec<_>>>()?
                    .into_iter()
                    .flatten()
                    .collect(),
            )
            .await?;
        for (row, id) in batch.iter().zip(ids) {
            written.rows.insert(
                row.id.clone(),
                WrittenRow {
                    database,
                    table,
                    row: id,
                },
            );
        }
    }

    written.relations = pending_relations(source, rows, &written);

    write_row_bodies(
        api,
        writer,
        user,
        item,
        *folder,
        share,
        rows,
        &written,
        page_column,
        links,
        destinations,
        progress,
        cancel,
        personal_folder,
    )
    .await?;
    Ok(written)
}

/// The database an earlier attempt created, or a new one, recorded before
/// anything is written into it.
async fn database_once<Writer: WorkspaceWriter, Store: WrittenObjects>(
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    folder: Option<Uuid>,
    progress: &Progress<'_, Store>,
) -> anyhow::Result<NewDatabase> {
    if let (Some(database_id), Some(table), Some(title_column)) = (
        progress.get(WrittenKind::Database),
        progress.get(WrittenKind::Table),
        progress.get(WrittenKind::TitleColumn),
    ) {
        return Ok(NewDatabase {
            database_id,
            table: TableId::from_uuid(table),
            title_column: ColumnId::from_uuid(title_column),
        });
    }
    let created = writer
        .create_database(
            user,
            derived_id(item.import_id, "database"),
            &capped_name(&item.title),
            folder,
        )
        .await
        .map_err(crate::domain::ports::DatabaseWriteFailure::from_backend)?;
    progress
        .record_all(vec![
            WrittenObject::own(item.import_id, WrittenKind::Database, created.database_id),
            WrittenObject::own(
                item.import_id,
                WrittenKind::Table,
                created.table.into_uuid(),
            ),
            WrittenObject::own(
                item.import_id,
                WrittenKind::TitleColumn,
                created.title_column.into_uuid(),
            ),
        ])
        .await?;
    Ok(created)
}

/// Rename the starter table and title column and create the data source's
/// columns, in order.
fn schema_ops(item: &WriteItem, plan: &ColumnPlan, created: &NewDatabase) -> Vec<DatabaseOp> {
    std::iter::once(DatabaseOp::Table {
        table: created.table,
        change: TableChange::Rename {
            name: capped_name(&item.title),
            previous_name: None,
        },
    })
    .chain(plan.column_ops(created.table, created.title_column))
    .collect()
}

/// The rows earlier attempts inserted, by Notion row.
fn recorded_rows<Store: WrittenObjects>(
    progress: &Progress<'_, Store>,
    database: DatabaseId,
    table: TableId,
) -> HashMap<NotionId, WrittenRow> {
    progress
        .all(WrittenKind::Row)
        .into_iter()
        .filter_map(|(notion, row)| {
            let written = WrittenRow {
                database,
                table,
                row: RowId::from_uuid(row),
            };
            Some((NotionId::parse(&notion)?, written))
        })
        .collect()
}

/// Each relation property, with the written rows' related Notion pages.
fn pending_relations(
    source: &NotionDataSource,
    rows: &[NotionPage],
    written: &WrittenDatabase,
) -> Vec<PendingRelation> {
    let Some(table) = written.table else {
        return Vec::new();
    };
    let names = ColumnNames::new(&source.properties);
    source
        .properties
        .iter()
        .filter_map(|property| {
            let NotionPropertyKind::Relation { data_source_id } = &property.kind else {
                return None;
            };
            let links = rows
                .iter()
                .filter_map(|row| {
                    let related = match row.properties.get(&property.name)? {
                        NotionValue::Relation(ids) => ids.clone(),
                        _ => return None,
                    };
                    let written_row = written.rows.get(&row.id)?;
                    (!related.is_empty()).then_some((written_row.row, related))
                })
                .collect();
            Some(PendingRelation {
                database: written.database_id,
                table,
                name: names.of(property),
                target: data_source_id.clone(),
                links,
            })
        })
        .collect()
}

/// A database an earlier attempt finished writing, rebuilt from what it
/// recorded so relations to it (and its own, if not yet linked) can still
/// be linked. `None` when it was never created.
pub(in super::super) async fn recorded_database<Api: NotionApi, Store: WrittenObjects>(
    api: &Api,
    item: &WriteItem,
    progress: &Progress<'_, Store>,
) -> anyhow::Result<Option<WrittenDatabase>> {
    progress.ensure_supported()?;
    let (Some(database_id), Some(table)) = (
        progress.get(WrittenKind::Database),
        progress.get(WrittenKind::Table),
    ) else {
        return Ok(None);
    };
    let table = TableId::from_uuid(table);
    let mut written = WrittenDatabase {
        import_id: item.import_id,
        database_id,
        table: Some(table),
        rows: recorded_rows(progress, DatabaseId::from_uuid(database_id), table),
        relations_created: progress.all(WrittenKind::Relation).into_keys().collect(),
        relations_linked: progress
            .all(WrittenKind::RelationLinked)
            .into_keys()
            .collect(),
        ..WrittenDatabase::default()
    };
    let source = api.data_source(&item.notion_id).await?;
    let names = ColumnNames::new(&source.properties);
    let unlinked = source.properties.iter().any(|property| {
        matches!(property.kind, NotionPropertyKind::Relation { .. })
            && !written.relations_linked.contains(&names.of(property))
    });
    // Only a database with relations left to link needs its rows again.
    if unlinked {
        let rows = all_rows(api, &item.notion_id).await?.rows;
        written.relations = pending_relations(&source, &rows, &written);
    }
    Ok(Some(written))
}

fn inserted_rows(results: &[OpResult]) -> Vec<RowId> {
    results
        .iter()
        .filter_map(|result| match result {
            OpResult::Rows {
                change: RowsResult::Inserted { rows },
                ..
            } => Some(rows.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

/// Rows with page content get a document in a folder beside the database,
/// linked from the row's Page column, and shared with the database. Bodies
/// an earlier attempt wrote are linked without fetching them again.
#[expect(
    clippy::too_many_arguments,
    reason = "row bodies need the rows, their database, links and progress"
)]
#[tracing::instrument(name = "notion.database_row_bodies", skip_all, fields(source_id = %item.notion_id, rows = rows.len() as i64), err)]
async fn write_row_bodies<Api: NotionApi, Writer: WorkspaceWriter, Store: WrittenObjects>(
    api: &Api,
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    folder: Option<Uuid>,
    share: bool,
    rows: &[NotionPage],
    written: &WrittenDatabase,
    page_column: PageColumn,
    links: &tokio::sync::RwLock<NotionLinks>,
    destinations: &super::super::databases::DatabaseDestinations,
    progress: &Progress<'_, Store>,
    cancel: &Cancel,
    personal_folder: Option<Uuid>,
) -> anyhow::Result<()> {
    let visibility = ImportVisibility::from_shared(item.shared);
    let bodies_folder: tokio::sync::OnceCell<Uuid> =
        tokio::sync::OnceCell::new_with(personal_folder);
    let bodies_name = capped_name(&format!("{} pages", item.title));
    let linked: Vec<anyhow::Result<Option<RowChange>>> = stream::iter(rows.iter().cloned())
        .map(|row| {
            let bodies_folder = &bodies_folder;
            let bodies_name = &bodies_name;
            async move {
                cancel.ensure_running()?;
                let Some(written_row) = written.rows.get(&row.id) else {
                    return Ok(None);
                };
                let change = |document: Uuid| RowChange {
                    row: written_row.row,
                    cells: vec![CellWrite {
                        column: page_column.id,
                        value: CellValue::Entities(vec![EntityRef {
                            entity_type: EntityKind::Document,
                            entity_id: document.to_string(),
                        }]),
                    }],
                };
                if let Some(document) = progress.get_for(WrittenKind::Body, row.id.as_str()) {
                    return Ok(Some(change(document)));
                }
                let (markdown, database_links) = match super::super::databases::body_links(
                    api,
                    &row.id,
                    &row.title,
                    destinations,
                    progress,
                )
                .await
                {
                    Ok(body) => body,
                    Err(error) => {
                        progress.loss(crate::domain::models::SourceLossFact {
                            object: row.id.clone(),
                            detail: crate::domain::models::SourceLossDetail::Notice {
                                notice: ImportNotice::new(
                                    &row.id,
                                    &row.title,
                                    ImportNoticeKind::RowBodyUnavailable,
                                ),
                            },
                        })?;
                        return Err(error);
                    }
                };
                if markdown.trim().is_empty() {
                    progress.record_all(progress.loss_markers(&row.id)?).await?;
                    return Ok(None);
                }
                let folder = *bodies_folder
                    .get_or_try_init(|| async {
                        let bodies = folder_once(
                            writer,
                            user,
                            progress,
                            WrittenKind::BodiesFolder,
                            bodies_name,
                            folder,
                            visibility,
                        )
                        .await?;
                        // A shared database's row bodies are shared with it,
                        // before any lands in the folder.
                        if share {
                            writer
                                .share_with_team(user, SharedEntity::Folder(bodies))
                                .await?;
                        }
                        anyhow::Ok(bodies)
                    })
                    .await?;
                let title = if row.title.trim().is_empty() {
                    super::super::plan::UNTITLED_PAGE.to_string()
                } else {
                    row.title.trim().to_string()
                };
                let id = derived_id(item.import_id, &format!("body/{}", row.id.as_str()));
                let mut row_links = links.read().await.clone();
                row_links.databases = database_links;
                let document = writer
                    .create_document(
                        user,
                        id,
                        &title,
                        &markdown,
                        &row_links,
                        &ImportedDocumentProperties::default(),
                        Some(folder),
                        Some(SourceDates::from(&row)),
                        visibility,
                    )
                    .await?;
                let document = progress
                    .record_document(WrittenKind::Body, &row.id, &document)
                    .await?;
                Ok(Some(change(document)))
            }
            .boxed()
        })
        .buffer_unordered(BODY_CONCURRENCY)
        .collect()
        .await;
    let mut changes = Vec::new();
    for outcome in linked {
        match outcome {
            Ok(Some(change)) => changes.push(change),
            Ok(None) => {}
            // One unreadable row body never loses the row itself.
            Err(error) => tracing::warn!(error = ?error, "notion row body was not imported"),
        }
    }
    cancel.ensure_running()?;
    let Some(table) = written.table else {
        return Ok(());
    };
    if changes.is_empty() {
        return Ok(());
    }
    // Keep the text title first: relation chips name rows by that column.
    // Put the row's page immediately after it so its body is one click away.
    if progress.get(WrittenKind::PageColumn).is_none() {
        writer
            .apply_database_ops(
                user,
                written.database_id,
                vec![
                    DatabaseOp::Column {
                        table,
                        column: page_column.id,
                        change: ColumnChange::Create {
                            definition: NewColumn::New {
                                name: page_column.name.clone(),
                                kind: ColumnKind::Entity {
                                    target: EntityKind::Document,
                                    multi: false,
                                },
                                options: Vec::new(),
                                infer_type: false,
                            },
                            after: None,
                        },
                    },
                    DatabaseOp::Table {
                        table,
                        change: TableChange::ReorderColumns {
                            order: page_column
                                .order
                                .first()
                                .copied()
                                .into_iter()
                                .chain(std::iter::once(page_column.id))
                                .chain(page_column.order.iter().skip(1).copied())
                                .collect(),
                        },
                    },
                ],
            )
            .await?;
        progress
            .record(WrittenKind::PageColumn, page_column.id.into_uuid())
            .await?;
    }
    // Setting a cell again is harmless, so a resumed write fills them all.
    for batch in owned_batches(&changes) {
        cancel.ensure_running()?;
        writer
            .apply_database_ops(
                user,
                written.database_id,
                vec![DatabaseOp::Rows {
                    table,
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow { rows: batch },
                    },
                }],
            )
            .await?;
    }
    Ok(())
}

/// The column linking each row to its page document.
#[derive(Debug, Clone)]
pub(in super::super) struct PageColumn {
    /// The column id, derived from the database so every attempt names it.
    id: ColumnId,
    /// Its name, distinct from the data source's own columns.
    name: String,
    /// Title first, then the table's other planned columns; Page goes after the title.
    order: Vec<ColumnId>,
}

/// "Page", or the first variant no Notion column of the same data source is
/// already called (case-insensitively).
pub(in super::super) fn page_column_name(properties: &[NotionPropertySchema]) -> String {
    let taken = |name: &str| {
        properties
            .iter()
            .any(|property| property.name.trim().eq_ignore_ascii_case(name))
    };
    std::iter::once(PAGE_COLUMN.to_string())
        .chain(std::iter::once(format!("{PAGE_COLUMN} (Notion)")))
        .chain((2..).map(|index| format!("{PAGE_COLUMN} {index}")))
        .find(|name| !taken(name))
        .unwrap_or_else(|| PAGE_COLUMN.to_string())
}

/// `items` in insert-sized batches, owned so no borrow is held across the
/// writes.
fn owned_batches<Item: Clone>(items: &[Item]) -> Vec<Vec<Item>> {
    items.chunks(ROWS_PER_BATCH).map(<[Item]>::to_vec).collect()
}

/// Link relations once every database exists: each relation whose target
/// data source was written becomes a relation column filled with the written
/// rows. A relation to something left in Notion is dropped. Columns an
/// earlier attempt created are reused, and finished ones skipped.
pub(in super::super) async fn link_relations<Writer: WorkspaceWriter, Store: WrittenObjects>(
    writer: &Writer,
    store: &Store,
    user: &MacroUserIdStr<'static>,
    databases: &HashMap<NotionId, WrittenDatabase>,
    cancel: &Cancel,
) -> anyhow::Result<()> {
    let rows: HashMap<&NotionId, WrittenRow> = databases
        .values()
        .flat_map(|database| database.rows.iter().map(|(id, row)| (id, *row)))
        .collect();
    for database in databases.values() {
        for relation in &database.relations {
            cancel.ensure_running()?;
            if database.relations_linked.contains(&relation.name) {
                continue;
            }
            let Some(target) = relation
                .target
                .as_ref()
                .and_then(|target| databases.get(target))
            else {
                continue;
            };
            let Some(target_table) = target.table else {
                continue;
            };
            let column = ColumnId::from_uuid(derived_id(
                relation.database,
                &format!("relation/{}", relation.name),
            ));
            let record = |kind| {
                let object = WrittenObject {
                    import_id: database.import_id,
                    kind,
                    object: relation.name.clone(),
                    macro_id: column.into_uuid(),
                };
                async move { store.record_written(user, &[object]).await }
            };
            if !database.relations_created.contains(&relation.name) {
                writer
                    .apply_database_ops(
                        user,
                        relation.database,
                        vec![DatabaseOp::Column {
                            table: relation.table,
                            column,
                            change: ColumnChange::Create {
                                definition: NewColumn::New {
                                    name: relation.name.clone(),
                                    kind: ColumnKind::Relation {
                                        database: DatabaseId::from_uuid(target.database_id),
                                        table: target_table,
                                    },
                                    options: Vec::new(),
                                    infer_type: false,
                                },
                                after: None,
                            },
                        }],
                    )
                    .await?;
                record(WrittenKind::Relation).await?;
            }
            let changes: Vec<RowChange> = relation
                .links
                .iter()
                .filter_map(|(row, related)| {
                    let linked: Vec<RowId> = related
                        .iter()
                        .filter_map(|id| rows.get(id))
                        .filter(|written| written.table == target_table)
                        .map(|written| written.row)
                        .collect();
                    (!linked.is_empty()).then(|| RowChange {
                        row: *row,
                        cells: vec![CellWrite {
                            column,
                            value: CellValue::Rows(linked),
                        }],
                    })
                })
                .collect();
            for batch in owned_batches(&changes) {
                cancel.ensure_running()?;
                writer
                    .apply_database_ops(
                        user,
                        relation.database,
                        vec![DatabaseOp::Rows {
                            table: relation.table,
                            change: RowsChange::Update {
                                changes: RowChanges::PerRow { rows: batch },
                            },
                        }],
                    )
                    .await?;
            }
            record(WrittenKind::RelationLinked).await?;
        }
    }
    Ok(())
}
