//! User-facing fidelity sentences; source paths stay inside the translator.

use std::collections::{BTreeMap, BTreeSet};

use import_notion::domain::model::{NotionDataSource, NotionPropertyKind};
use import_notion::domain::views::{NotionView, ViewLoss, ViewLossKind, ViewType};
use serde_json::{Value, json};

/// Schema losses are visible in both the staged plan and the final report.
pub(super) fn property_warnings(source: &NotionDataSource, title: &str) -> Vec<String> {
    source.properties.iter().filter_map(|property| match &property.kind {
        NotionPropertyKind::Formula => Some(format!("Database “{title}”: “{}” is a fixed snapshot of the Notion formula, not a live formula.", property.name)),
        NotionPropertyKind::Rollup => Some(format!("Database “{title}”: “{}” is a fixed snapshot of the Notion rollup, not a live rollup.", property.name)),
        NotionPropertyKind::Unsupported { notion_type } => Some(format!("Database “{title}”: property “{}” was omitted because Notion {notion_type} properties are not supported.", property.name)),
        _ => None,
    }).collect()
}

/// Preserve distinct loss counts even when their readable descriptions match.
pub(super) fn view_warnings(
    source: &NotionDataSource,
    title: &str,
    view: &NotionView,
    losses: &[ViewLoss],
) -> Vec<String> {
    let mut grouped = BTreeMap::new();
    for loss in losses {
        let known = grouped
            .entry(view_loss(source, title, view, loss))
            .or_insert((loss.kind, 0u32));
        known.1 = known.1.saturating_add(1);
    }
    grouped
        .into_iter()
        .map(|(message, (kind, count))| {
            if count == 1 {
                return message;
            }
            let details = match kind {
                ViewLossKind::Filter => "filter conditions",
                ViewLossKind::Sort => "sort rules",
                ViewLossKind::Layout => "layout details",
                ViewLossKind::Setting => "display settings",
            };
            format!("{message} {count} {details} were affected.")
        })
        .collect()
}

/// Use the closest source property context, never print its internal JSON path.
fn view_loss(source: &NotionDataSource, title: &str, view: &NotionView, loss: &ViewLoss) -> String {
    let root = json!({"filter":view.filter,"sorts":view.sorts,"configuration":view.configuration});
    let mut current = &root;
    let mut property_context = None;
    for token in loss
        .path
        .split(['.', '[', ']'])
        .filter(|part| !part.is_empty())
    {
        let next = if let Some(array) = current.as_array() {
            token
                .parse::<usize>()
                .ok()
                .and_then(|index| array.get(index))
        } else {
            current.get(token)
        };
        let Some(next) = next else { break };
        current = next;
        if property_reference(current).is_some() {
            property_context = Some(current);
        }
    }
    let mut names = BTreeSet::new();
    property_titles(property_context.unwrap_or(current), source, &mut names);
    let properties = names
        .into_iter()
        .map(|name| format!("“{name}”"))
        .collect::<Vec<_>>()
        .join(", ");
    let context = if properties.is_empty() {
        String::new()
    } else {
        format!(" for {properties}")
    };
    let detail = match loss.kind {
        ViewLossKind::Filter => format!(
            "the filter{context} could not be preserved exactly; this view may show additional rows"
        ),
        ViewLossKind::Sort => {
            format!("the sort{context} was omitted; rows may appear in a different order")
        }
        ViewLossKind::Layout => {
            let layout = match view.kind {
                ViewType::Table => "table",
                ViewType::Board => "board",
                ViewType::Timeline => "timeline",
                ViewType::List => "list",
                ViewType::Calendar => "calendar",
                ViewType::Gallery => "gallery",
                ViewType::Form => "form",
                ViewType::Chart => "chart",
                ViewType::Map => "map",
                ViewType::Dashboard => "dashboard",
                ViewType::Unknown => "Notion",
            };
            format!("the {layout} layout is shown as a table")
        }
        ViewLossKind::Setting => {
            if loss.path.ends_with(".visible") {
                if view.kind == ViewType::Table {
                    format!(
                        "column visibility{context} could not be kept; imported table columns stay visible"
                    )
                } else {
                    format!("column visibility{context} could not be preserved exactly")
                }
            } else if loss.path.ends_with(".width") {
                format!("the column width{context} could not be kept")
            } else if loss.path.contains("group_by") {
                format!("the grouping or lane order{context} could not be preserved exactly")
            } else {
                let setting = loss.path.rsplit('.').next().unwrap_or("display");
                let setting = if setting.contains(['[', ']']) || setting == "configuration" {
                    "display".to_owned()
                } else {
                    setting.replace('_', " ")
                };
                format!("the {setting} setting{context} could not be kept")
            }
        }
    };
    format!("Database “{}”, view “{}”: {detail}.", title, view.name)
}

fn property_reference(value: &Value) -> Option<&str> {
    [
        "property",
        "property_id",
        "date_property_id",
        "start_date_property_id",
        "end_date_property_id",
    ]
    .iter()
    .find_map(|key| value.get(key).and_then(Value::as_str))
}

fn property_titles<'a>(value: &Value, source: &'a NotionDataSource, names: &mut BTreeSet<&'a str>) {
    if let Some(reference) = property_reference(value)
        && let Some(property) = source
            .properties
            .iter()
            .find(|property| property.id == reference || property.name == reference)
    {
        names.insert(property.name.as_str());
    }
    match value {
        Value::Array(values) => {
            for value in values {
                property_titles(value, source, names);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                property_titles(value, source, names);
            }
        }
        _ => {}
    }
}
