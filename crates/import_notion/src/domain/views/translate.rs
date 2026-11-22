//! Translation orchestration and bindings for the existing column plan.
use std::collections::BTreeMap;

use models_databases::views::{NewView, SortDirection, SortKey, ViewQuery};
use models_databases::{ColumnId, ColumnKind};

use super::model::*;
use super::{filter, layout};
use crate::domain::macro_cells::{ColumnPlan, capped_name};
use crate::domain::model::{NotionDataSource, NotionPropertyKind};

/// Bind stable ids and original names using the columns/cells the importer
/// actually writes. The title column is created separately by Macro.
pub fn bindings(
    source: &NotionDataSource,
    plan: &ColumnPlan,
    title: ColumnId,
) -> Vec<ViewColumnBinding> {
    source
        .properties
        .iter()
        .filter_map(|property| {
            let (column, kind, options) = if property.kind == NotionPropertyKind::Title {
                (title, ColumnKind::Text, BTreeMap::new())
            } else {
                let planned = plan
                    .columns
                    .iter()
                    .find(|column| column.property_id == property.id)?;
                let options = match &property.kind {
                    NotionPropertyKind::Select { options }
                    | NotionPropertyKind::Status { options }
                    | NotionPropertyKind::MultiSelect { options } => options
                        .iter()
                        .filter_map(|option| {
                            planned
                                .option_ids
                                .get(&option.id)
                                .map(|id| (option.name.clone(), *id))
                        })
                        .collect(),
                    _ => BTreeMap::new(),
                };
                (planned.id, planned.shape.kind(), options)
            };
            Some(ViewColumnBinding {
                property_id: property.id.clone(),
                property_name: property.name.clone(),
                column,
                kind,
                options,
                snapshot: matches!(
                    property.kind,
                    NotionPropertyKind::Formula | NotionPropertyKind::Rollup
                ),
            })
        })
        .collect()
}

/// Translate using the imported schema. Unsupported AND clauses and incomplete
/// OR groups are omitted with losses, preserving a superset of the source rows.
#[tracing::instrument(name = "notion.translate_view", skip_all, fields(view_id = %view.id, losses = tracing::field::Empty))]
pub fn translate(view: &NotionView, columns: &[ViewColumnBinding]) -> TranslatedView {
    let mut losses = Vec::new();
    let filter = view
        .filter
        .as_ref()
        .and_then(|value| filter::translate(value, columns, &mut losses));
    let mut sort = Vec::new();
    for (index, value) in view.sorts.iter().flatten().enumerate() {
        let path = format!("sorts[{index}]");
        let binding = value
            .get("property")
            .and_then(|v| v.as_str())
            .and_then(|p| column(columns, p));
        let direction = match value.get("direction").and_then(|v| v.as_str()) {
            Some("ascending") => Some(SortDirection::Ascending),
            Some("descending") => Some(SortDirection::Descending),
            _ => None,
        };
        match (binding, direction) {
            (Some(binding), Some(direction))
                if !binding.snapshot && value.as_object().is_some_and(|v| v.len() == 2) =>
            {
                sort.push(SortKey {
                    column: binding.column,
                    direction,
                })
            }
            _ => loss(
                &mut losses,
                ViewLossKind::Sort,
                &path,
                "Sort key has no equivalent on the imported column (including timestamp or computed sorts)",
            ),
        }
    }
    let layout = layout::translate(view, columns, &mut losses);
    for (key, value) in &view.extra {
        if !matches!(
            key.as_str(),
            "object"
                | "parent"
                | "created_time"
                | "created_by"
                | "last_edited_time"
                | "last_edited_by"
                | "url"
                | "dashboard_view_id"
        ) && !value.is_null()
        {
            setting_loss(
                &mut losses,
                setting_kind(key),
                key,
                "View setting has no Macro equivalent",
            );
        }
    }
    if view.data_source_id.is_none() {
        loss(
            &mut losses,
            ViewLossKind::Layout,
            "data_source_id",
            "View has no single data source",
        );
    }
    let mut name = capped_name(&view.name);
    if name.is_empty() {
        name = "Imported view".to_owned();
    }
    tracing::Span::current().record("losses", losses.len() as i64);
    TranslatedView {
        source_view_id: view.id.clone(),
        view: NewView {
            name,
            query: ViewQuery { filter, sort },
            layout,
        },
        losses,
    }
}
