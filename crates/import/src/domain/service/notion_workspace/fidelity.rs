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
            properties: property_names(source, view, loss),
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
fn property_names(source: &NotionDataSource, view: &NotionView, loss: &ViewLoss) -> Vec<String> {
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
    names.into_iter().map(str::to_owned).collect()
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
