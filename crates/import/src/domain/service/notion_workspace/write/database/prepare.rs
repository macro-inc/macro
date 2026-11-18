//! Reserve destinations, columns and saved presets before any body conversion.

use import_notion::domain::macro_cells::{MAX_NAME, date_range_properties};
use import_notion::domain::views::{self, ViewLossKind, ViewScope, ViewType};
use models_databases::views::ViewId;

use super::super::super::databases::{read_failure, read_views};
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
#[tracing::instrument(name = "notion.prepare_database", skip_all, fields(source_id = %item.notion_id, database_id = tracing::field::Empty, views = tracing::field::Empty, rows_read_scan = tracing::field::Empty), err)]
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
) -> anyhow::Result<PreparedDatabase> {
    let source = api.data_source(&item.notion_id).await?;
    let created = database_once(writer, user, item, folder, progress).await?;
    let schema = derived_id(
        created.database_id,
        &format!("schema/{}", serde_json::to_string(&source.properties)?),
    );
    if let Some(recorded) = progress.get(WrittenKind::SchemaPlan) {
        anyhow::ensure!(
            recorded == schema,
            "Notion source schema changed after schema planning; this source cannot resume against its reserved columns"
        );
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
        .map(|property| format!("Source {}: {}", item.notion_id, names.of(property)))
        .collect();
    progress.warn(&snapshots).await?;
    // Retain only property ids: reservation spans the whole workspace, so row
    // snapshots here would keep every source in memory until writing begins.
    let mut ranges = HashSet::new();
    let mut rows_read = 0usize;
    let mut cursor = None;
    loop {
        let page = api.query_data_source(&item.notion_id, cursor).await?;
        rows_read += page.rows.len();
        ranges.extend(date_range_properties(&source, &page.rows));
        match page.next {
            import_notion::domain::model::RowsNext::More { cursor: next } => cursor = Some(next),
            import_notion::domain::model::RowsNext::End => break,
            import_notion::domain::model::RowsNext::Truncated => {
                progress
                    .warn(&[format!(
                        "Source {}: Notion returned an incomplete date-range scan",
                        item.notion_id
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
                        "Source {}: saved views unavailable ({reason:?})",
                        item.notion_id
                    )])
                    .await?;
                Vec::new()
            }
            None => return Err(error.into()),
        },
    };
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
        if planned != ranges {
            progress.warn(&[format!("Source {}: date-range usage changed after schema planning; preserving the recorded column shapes", item.notion_id)]).await?;
        }
        ranges = planned;
    } else {
        anyhow::ensure!(
            progress.get(WrittenKind::Schema).is_none(),
            "written database schema has no recorded column-planning facts"
        );
        // Persist both empty and populated sets atomically, before the schema
        // call: a lost response must replay the same column shapes too.
        let facts = std::iter::once(WrittenObject::own(
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
        progress.record_all(facts).await?;
    }
    let plan = ColumnPlan::new_with_date_ranges(&source, created.database_id, &ranges);
    if progress.get(WrittenKind::Schema).is_none() {
        writer
            .apply_database_ops(user, created.database_id, schema_ops(item, &plan, &created))
            .await?;
        progress
            .record(WrittenKind::Schema, created.database_id)
            .await?;
    }
    let bindings = views::bindings(&source, &plan, created.title_column);
    let mut saved = HashSet::new();
    for view in presets {
        if view.data_source_id.as_ref() != Some(&item.notion_id) {
            progress
                .warn(&[format!("View {}: source identity mismatch", view.id)])
                .await?;
            continue;
        }
        let mut translated = views::translate(&view, &bindings);
        let warnings: Vec<String> = translated
            .losses
            .iter()
            .map(|loss| {
                format!(
                    "Source {}, view {}: {:?} at {}: {}",
                    item.notion_id, view.id, loss.kind, loss.path, loss.reason
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
        let suffix = format!("{marker} [{}]", view.id);
        let prefix: String = translated
            .view
            .name
            .trim()
            .chars()
            .take(MAX_NAME.saturating_sub(suffix.chars().count()))
            .collect();
        translated.view.name = format!("{prefix}{suffix}");
        let id = ViewId::from_uuid(derived_id(
            created.database_id,
            &format!("view/{}", view.id),
        ));
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
                .await?;
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
