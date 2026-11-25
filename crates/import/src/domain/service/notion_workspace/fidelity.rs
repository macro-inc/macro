//! Typed fidelity construction; sentences are rendered only by the report model.
use crate::domain::models::{FidelityWarning, PropertySnapshotKind, ViewWarning};
use import_notion::domain::model::{NotionDataSource, NotionPropertyKind};
use import_notion::domain::views::{NotionView, ViewLoss};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Build typed schema notices shared by planning and writing.
pub(super) fn property_warnings(source: &NotionDataSource, title: &str) -> Vec<FidelityWarning> {
    source
        .properties
        .iter()
        .filter_map(|property| match &property.kind {
            NotionPropertyKind::Formula | NotionPropertyKind::Rollup => {
                Some(FidelityWarning::PropertySnapshot {
                    source_id: source.id.clone(),
                    property_id: property.id.clone(),
                    source: title.into(),
                    property: property.name.clone(),
                    kind: if property.kind == NotionPropertyKind::Formula {
                        PropertySnapshotKind::Formula
                    } else {
                        PropertySnapshotKind::Rollup
                    },
                })
            }
            NotionPropertyKind::Unsupported { notion_type } => {
                Some(FidelityWarning::PropertyOmitted {
                    source_id: source.id.clone(),
                    property_id: property.id.clone(),
                    source: title.into(),
                    property: property.name.clone(),
                    notion_type: notion_type.clone(),
                })
            }
            _ => None,
        })
        .collect()
}

/// Group semantic view losses while keeping their distinct counts.
pub(super) fn view_warnings(
    source: &NotionDataSource,
    title: &str,
    view: &NotionView,
    losses: &[ViewLoss],
) -> Vec<FidelityWarning> {
    let payload =
        json!({"filter":view.filter,"sorts":view.sorts,"configuration":view.configuration});
    let mut grouped = BTreeMap::new();
    for loss in losses {
        let warning = ViewWarning {
            source_id: source.id.clone(),
            view_id: view.id.clone(),
            source: title.into(),
            view: view.name.clone(),
            kind: loss.kind,
            setting: loss.setting,
            layout: view.kind,
            properties: property_names(source, &payload, &loss.path),
            count: 0,
        };
        let count = grouped.entry(warning).or_insert(0u32);
        *count = count.saturating_add(1);
    }
    grouped
        .into_iter()
        .map(|(mut loss, count)| {
            loss.count = count;
            FidelityWarning::ViewLoss(loss)
        })
        .collect()
}

// Paths are diagnostic locators for property context, never setting classifiers
// or printable labels. The translator supplies all setting semantics.
fn property_names(source: &NotionDataSource, payload: &Value, path: &str) -> Vec<String> {
    let mut current = payload;
    let mut property_context = None;
    let mut last = "";
    let mut tokens = path
        .split(['.', '[', ']'])
        .filter(|part| !part.is_empty())
        .peekable();
    let filter = tokens.peek() == Some(&"filter");
    for token in tokens {
        let next = if let Some(array) = current.as_array() {
            token
                .parse::<usize>()
                .ok()
                .and_then(|index| array.get(index))
        } else {
            current.get(token)
        };
        let Some(next) = next else {
            return Vec::new();
        };
        current = next;
        last = token;
        if let Some(reference) = property_reference(current) {
            property_context = Some(reference);
        }
    }
    let mut names = BTreeSet::new();
    let reference = match last {
        "date_property_id" | "start_date_property_id" | "end_date_property_id" => current.as_str(),
        _ => property_context,
    };
    if let Some(reference) = reference {
        insert_property_title(reference, source, &mut names);
    } else if filter {
        property_titles(current, source, &mut names);
    }
    names.into_iter().map(str::to_owned).collect()
}

fn property_reference(value: &Value) -> Option<&str> {
    ["property", "property_id"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
}

fn insert_property_title<'a>(
    reference: &str,
    source: &'a NotionDataSource,
    names: &mut BTreeSet<&'a str>,
) {
    if let Some(property) = import_notion::domain::views::resolve_property(
        &source.properties,
        reference,
        |property| &property.id,
        |property| &property.name,
    ) {
        names.insert(property.name.as_str());
    }
}

fn property_titles<'a>(value: &Value, source: &'a NotionDataSource, names: &mut BTreeSet<&'a str>) {
    if let Some(reference) = property_reference(value) {
        insert_property_title(reference, source, names);
    }
    match value {
        Value::Array(values) => {
            for value in values {
                property_titles(value, source, names);
            }
        }
        Value::Object(values) => {
            for group in ["and", "or"] {
                if let Some(children) = values.get(group).filter(|value| value.is_array()) {
                    property_titles(children, source, names);
                }
            }
        }
        _ => {}
    }
}
