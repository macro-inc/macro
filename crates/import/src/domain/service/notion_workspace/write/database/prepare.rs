//! Reserve destinations, columns and saved presets before any body conversion.

use import_notion::domain::macro_cells::{MAX_NAME, date_range_properties};
use import_notion::domain::views::{self, ViewLossKind, ViewScope, ViewType};
use models_databases::views::ViewId;

use super::super::super::databases::{ViewTab, read_failure, read_views};
use super::*;

/// Source snapshot and ready destination for the write phase.
pub(in super::super::super) struct PreparedDatabase {
    pub source: NotionDataSource,
    pub created: NewDatabase,
    pub plan: ColumnPlan,
    pub views: HashSet<ViewId>,
    pub folder: Option<Uuid>,
}

/// Create the owner-only database, then schema and deterministic saved views.
// The reservation caller records safe error types; raw errors may contain content.
#[tracing::instrument(name = "notion.prepare_database", skip_all, fields(source_id = %item.notion_id, database_id = tracing::field::Empty, views = tracing::field::Empty, rows_read_scan = tracing::field::Empty))]
pub(in super::super::super) async fn prepare_database<
    Api: NotionApi,
    Writer: WorkspaceWriter,
    Store: WrittenObjects,
>(
    api: &Api,
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    folder: Option<Uuid>,
    progress: &Progress<'_, Store>,
    cancel: &Cancel,
) -> anyhow::Result<PreparedDatabase> {
    cancel.ensure_running()?;
    progress.ensure_supported()?;
    let source = api.data_source(&item.notion_id).await?;
    let created = database_once(writer, user, item, folder, progress).await?;
    let schema = super::schema::fingerprint(&source, created.database_id)
        .map_err(|_| crate::domain::models::SourceStopReason::DatabaseRejected)?;
    let metadata = derived_id(
        created.database_id,
        &serde_json::to_string(&source.properties)?,
    );
    if progress
        .get(WrittenKind::SchemaMetadata)
        .is_some_and(|recorded| recorded != metadata)
    {
        progress.warn(&[format!("Database {}: property names or options changed; preserving the reserved schema and matching values by option id when available, otherwise by name", item.title)]).await?;
    }
    let stop = if progress
        .get(WrittenKind::SchemaPlan)
        .is_some_and(|recorded| recorded != schema)
    {
        Some(crate::domain::models::SourceStopReason::SchemaChanged)
    } else if progress.get(WrittenKind::Schema).is_some()
        && progress.get(WrittenKind::SchemaPlan).is_none()
    {
        Some(crate::domain::models::SourceStopReason::MissingSchemaPlan)
    } else {
        None
    };
    if let Some(reason) = stop {
        progress.source_stopped(&item.title, reason).await?;
        return Err(reason.into());
    }
    let names = ColumnNames::new(&source.properties);
    let snapshots: Vec<String> = source
        .properties
        .iter()
        .filter(|property| {
            matches!(
                property.kind,
                NotionPropertyKind::Formula | NotionPropertyKind::Rollup
            )
        })
        .map(|property| format!("Database {}: {}", item.title, names.of(property)))
        .collect();
    progress.warn(&snapshots).await?;
    // Retain only property ids: reservation spans the whole workspace, so row
    // snapshots here would keep every source in memory until writing begins.
    let mut ranges = HashSet::new();
    let mut rows_read = 0usize;
    let mut cursor = None;
    while progress.get(WrittenKind::SchemaPlan).is_none() {
        cancel.ensure_running()?;
        let page = api.query_data_source(&item.notion_id, cursor).await?;
        cancel.ensure_running()?;
        rows_read += page.rows.len();
        ranges.extend(date_range_properties(&source, &page.rows));
        match page.next {
            import_notion::domain::model::RowsNext::More { cursor: next } => cursor = Some(next),
            import_notion::domain::model::RowsNext::End => break,
            import_notion::domain::model::RowsNext::Truncated => {
                progress
                    .warn(&[format!(
                        "Database {}: Notion returned an incomplete date-range scan",
                        item.title
                    )])
                    .await?;
                break;
            }
        }
    }
    tracing::Span::current().record("rows_read_scan", rows_read as i64);
    let presets = match read_views(api, &ViewScope::DataSource(item.notion_id.clone())).await {
        Ok(presets) => presets,
        Err(error) => match read_failure(&error) {
            Some(reason) => {
                progress
                    .warn(&[format!(
                        "Database {}: saved views unavailable ({reason})",
                        item.title
                    )])
                    .await?;
                Vec::new()
            }
            None => return Err(error.into()),
        },
    };
    let mut readable = Vec::new();
    for (index, tab) in presets.into_iter().enumerate() {
        match tab {
            ViewTab::Ready(view) => readable.push(*view),
            ViewTab::Unavailable { reason, .. } => {
                progress
                    .warn(&[format!(
                        "Database {}, saved tab {}: {reason}",
                        item.title,
                        index + 1
                    )])
                    .await?
            }
        }
    }
    let presets = readable;
    for view in presets
        .iter()
        .filter(|view| view.data_source_id.as_ref() == Some(&source.id))
    {
        if view.kind == ViewType::Timeline
            && let Some(property) = view
                .configuration
                .as_ref()
                .and_then(|value| value.get("date_property_id"))
                .and_then(serde_json::Value::as_str)
        {
            ranges.insert(property.to_string());
        }
    }
    if progress.get(WrittenKind::SchemaPlan).is_some() {
        let planned: HashSet<String> = progress
            .all(WrittenKind::DateRangeProperty)
            .into_keys()
            .collect();
        ranges = planned;
    } else {
        // Persist both empty and populated sets atomically, before the schema
        // call: a lost response must replay the same column shapes too.
        let mut facts: Vec<_> = std::iter::once(WrittenObject::own(
            item.import_id,
            WrittenKind::SchemaPlan,
            schema,
        ))
        .chain(ranges.iter().map(|property| WrittenObject {
            import_id: item.import_id,
            kind: WrittenKind::DateRangeProperty,
            object: property.clone(),
            macro_id: created.database_id,
        }))
        .collect();
        facts.push(WrittenObject::own(
            item.import_id,
            WrittenKind::SchemaMetadata,
            metadata,
        ));
        let plan = ColumnPlan::new_with_date_ranges(&source, created.database_id, &ranges);
        facts.extend(super::schema::option_markers(&plan, item.import_id)?);
        progress.record_all(facts).await?;
    }
    let mut plan = ColumnPlan::new_with_date_ranges(&source, created.database_id, &ranges);
    super::schema::restore_options(&mut plan, progress)?;
    if progress.get(WrittenKind::Schema).is_none() {
        writer
            .apply_database_ops(user, created.database_id, schema_ops(item, &plan, &created))
            .await
            .map_err(crate::domain::ports::DatabaseWriteFailure::from_backend)?;
        progress
            .record(WrittenKind::Schema, created.database_id)
            .await?;
    }
    let bindings = views::bindings(&source, &plan, created.title_column);
    let mut saved = HashSet::new();
    for view in presets {
        if view.data_source_id.as_ref() != Some(&item.notion_id) {
            progress
                .warn(&[format!("View {}: source identity mismatch", view.name)])
                .await?;
            continue;
        }
        let mut translated = views::translate(&view, &bindings);
        let warnings: Vec<String> = translated
            .losses
            .iter()
            .map(|loss| {
                format!(
                    "Database {}, view {}: {} at {}: {}",
                    item.title, view.name, loss.kind, loss.path, loss.reason
                )
            })
            .collect();
        progress.warn(&warnings).await?;
        let approximated = translated
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Filter);
        let marker = if approximated {
            " (filter approximated)"
        } else {
            ""
        };
        let id = ViewId::from_uuid(derived_id(
            created.database_id,
            &format!("view/{}", view.id),
        ));
        let name = reserve_view_name(progress, &view.id, id, &translated.view.name, marker).await?;
        translated.view.name = name;
        if progress
            .get_for(WrittenKind::View, view.id.as_str())
            .is_none()
        {
            writer
                .ensure_database_view(
                    user,
                    created.database_id,
                    created.table,
                    id,
                    translated.view,
                )
                .await
                .map_err(crate::domain::ports::DatabaseWriteFailure::from_backend)?;
            progress
                .record_for(WrittenKind::View, &view.id, id.into_uuid())
                .await?;
        }
        saved.insert(id);
    }
    tracing::Span::current().record("database_id", tracing::field::display(created.database_id));
    tracing::Span::current().record("views", saved.len() as i64);
    Ok(PreparedDatabase {
        source,
        created,
        plan,
        views: saved,
        folder,
    })
}

/// Reserve readable names before creation so retries keep the same unique name.
async fn reserve_view_name<Store: WrittenObjects>(
    progress: &Progress<'_, Store>,
    notion: &NotionId,
    id: ViewId,
    name: &str,
    marker: &str,
) -> anyhow::Result<String> {
    let mut taken = HashSet::new();
    for (payload, _) in progress.all(WrittenKind::ViewName) {
        let (known, name): (NotionId, String) = serde_json::from_str(&payload)?;
        if &known == notion {
            return Ok(name);
        }
        taken.insert(name.to_lowercase());
    }
    let base = if name.trim().is_empty() {
        "Untitled view"
    } else {
        name.trim()
    };
    for index in 1.. {
        let duplicate = if index == 1 {
            String::new()
        } else {
            format!(" {index}")
        };
        let suffix = format!("{duplicate}{marker}");
        let prefix: String = base
            .chars()
            .take(MAX_NAME.saturating_sub(suffix.chars().count()))
            .collect();
        let name = format!("{prefix}{suffix}");
        if taken.insert(name.to_lowercase()) {
            progress
                .record_all(vec![WrittenObject {
                    import_id: progress.import_id,
                    kind: WrittenKind::ViewName,
                    object: serde_json::to_string(&(notion, &name))?,
                    macro_id: id.into_uuid(),
                }])
                .await?;
            return Ok(name);
        }
    }
    unreachable!("view suffixes are unbounded")
}
