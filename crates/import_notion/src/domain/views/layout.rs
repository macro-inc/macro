//! Layout settings are consumed explicitly; every remaining setting is a loss.
use std::collections::HashSet;

use models_databases::{ColumnKind, EntityKind, views::*};
use serde_json::Value;

use super::model::*;

pub(super) fn translate(
    view: &NotionView,
    columns: &[ViewColumnBinding],
    losses: &mut Vec<ViewLoss>,
) -> RequestedLayout {
    let fallback = || RequestedLayout::Table {
        columns: Vec::new(),
    };
    let Some(config) = view.configuration.as_ref().and_then(Value::as_object) else {
        if view.configuration.is_some() {
            setting_loss(
                losses,
                ViewSetting::Other,
                "configuration",
                "Configuration is not an object",
            );
        }
        if view.kind != ViewType::Table {
            loss(
                losses,
                ViewLossKind::Layout,
                "configuration",
                "Layout has no usable configuration; using table",
            );
        }
        return fallback();
    };
    let expected = match view.kind {
        ViewType::Table => "table",
        ViewType::Board => "board",
        ViewType::Timeline => "timeline",
        _ => "",
    };
    let matches_type = config.get("type").and_then(Value::as_str) == Some(expected);
    let properties = properties(config.get("properties"), columns, view.kind, losses);
    let mut consumed = vec!["type", "properties"];
    let result = match view.kind {
        ViewType::Table if matches_type => RequestedLayout::Table {
            columns: properties,
        },
        ViewType::Board if matches_type => {
            consumed.push("group_by");
            let group = config.get("group_by");
            let binding = group
                .and_then(|g| g.get("property_id"))
                .and_then(Value::as_str)
                .and_then(|id| column(columns, id));
            let group_kind = group.and_then(|g| g.get("type")).and_then(Value::as_str);
            let compatible = binding.is_some_and(|b| {
                !b.snapshot
                    && match (group_kind, b.kind) {
                        (Some("select" | "status"), ColumnKind::Select { multi: false }) => {
                            group_kind != Some("status")
                                || group
                                    .and_then(|g| g.get("group_by"))
                                    .and_then(Value::as_str)
                                    == Some("option")
                        }
                        (
                            Some("person" | "created_by" | "last_edited_by"),
                            ColumnKind::Entity {
                                target: EntityKind::User,
                                multi: false,
                            },
                        ) => true,
                        _ => false,
                    }
            });
            if let Some(binding) = binding.filter(|_| compatible) {
                let mut lanes = Vec::new();
                let order = group
                    .and_then(|g| g.get("sort"))
                    .and_then(|s| s.get("type"))
                    .and_then(Value::as_str);
                if matches!(binding.kind, ColumnKind::Select { .. })
                    && matches!(order, Some("ascending" | "descending"))
                {
                    let mut options: Vec<_> = binding.options.iter().collect();
                    options.sort_by_key(|(label, _)| label.to_lowercase());
                    if order == Some("descending") {
                        options.reverse();
                    }
                    let mut seen = HashSet::new();
                    lanes = options
                        .into_iter()
                        .filter(|(_, id)| seen.insert(**id))
                        .map(|(_, id)| Lane {
                            key: LaneKey::Option(*id),
                            hidden: false,
                        })
                        .collect();
                } else {
                    setting_loss(
                        losses,
                        ViewSetting::Grouping,
                        "configuration.group_by.sort",
                        "Notion lane order is unavailable or has no equivalent; using Macro's default lane order",
                    );
                }
                if let Some(group) = group.and_then(Value::as_object) {
                    remaining(
                        group,
                        &[
                            "type",
                            "property_id",
                            "group_by",
                            "sort",
                            "hide_empty_groups",
                        ],
                        "configuration.group_by",
                        ViewSetting::Grouping,
                        losses,
                    );
                    if let Some(sort) = group.get("sort").and_then(Value::as_object) {
                        remaining(
                            sort,
                            &["type"],
                            "configuration.group_by.sort",
                            ViewSetting::Grouping,
                            losses,
                        );
                    }
                }
                RequestedLayout::Board {
                    group_by: binding.column,
                    title: None,
                    lanes,
                    card_fields: properties.iter().map(|p| p.column).collect(),
                    hide_empty_lanes: group
                        .and_then(|g| g.get("hide_empty_groups"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                }
            } else {
                loss(
                    losses,
                    ViewLossKind::Layout,
                    "configuration.group_by",
                    "Board grouping has no equivalent on imported columns; using table",
                );
                RequestedLayout::Table {
                    columns: properties,
                }
            }
        }
        ViewType::Timeline if matches_type => {
            consumed.push("date_property_id");
            let range = config
                .get("date_property_id")
                .and_then(Value::as_str)
                .and_then(|id| column(columns, id))
                .filter(|b| b.kind == ColumnKind::DateRange);
            let separate_end = config
                .get("end_date_property_id")
                .is_some_and(|v| !v.is_null() && Some(v) != config.get("date_property_id"));
            if let Some(range) = range.filter(|_| !separate_end) {
                consumed.push("end_date_property_id");
                RequestedLayout::Timeline {
                    range: range.column,
                    title: None,
                    group_by: None,
                    bar_fields: properties.iter().map(|p| p.column).collect(),
                    color_by: None,
                }
            } else {
                loss(
                    losses,
                    ViewLossKind::Layout,
                    "configuration.date_property_id",
                    "Timeline requires one imported date-range column; separate start/end columns or date snapshots cannot span bars; using table",
                );
                RequestedLayout::Table {
                    columns: properties,
                }
            }
        }
        _ => {
            loss(
                losses,
                ViewLossKind::Layout,
                "type",
                "Layout or configuration type has no Macro equivalent; using table",
            );
            RequestedLayout::Table {
                columns: properties,
            }
        }
    };
    remaining(
        config,
        &consumed,
        "configuration",
        ViewSetting::Other,
        losses,
    );
    result
}

fn properties(
    value: Option<&Value>,
    columns: &[ViewColumnBinding],
    kind: ViewType,
    losses: &mut Vec<ViewLoss>,
) -> Vec<ViewColumn> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Vec::new();
    };
    let Some(properties) = value.as_array() else {
        setting_loss(
            losses,
            ViewSetting::Other,
            "configuration.properties",
            "Properties must be an array",
        );
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for (index, property) in properties.iter().enumerate() {
        let path = format!("configuration.properties[{index}]");
        let Some(binding) = property
            .get("property_id")
            .and_then(Value::as_str)
            .and_then(|id| column(columns, id))
        else {
            setting_loss(
                losses,
                ViewSetting::Other,
                &path,
                "Property has no imported column",
            );
            continue;
        };
        if let Some(property) = property.as_object() {
            remaining(
                property,
                &["property_id", "visible", "width"],
                &path,
                ViewSetting::Other,
                losses,
            );
        }
        if property
            .get("visible")
            .is_some_and(|value| !value.is_null() && !value.is_boolean())
        {
            setting_loss(
                losses,
                ViewSetting::ColumnVisibility,
                &format!("{path}.visible"),
                "Visibility must be a boolean",
            );
        }
        if property.get("visible") == Some(&Value::Bool(false)) {
            if kind == ViewType::Table {
                setting_loss(
                    losses,
                    ViewSetting::ColumnVisibility,
                    &format!("{path}.visible"),
                    "Macro table layouts cannot hide columns",
                );
            }
            continue;
        }
        let width = property.get("width").filter(|v| !v.is_null());
        let width_px = width
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok());
        if width.is_some() && (width_px.is_none() || kind != ViewType::Table) {
            setting_loss(
                losses,
                ViewSetting::ColumnWidth,
                &format!("{path}.width"),
                "Column width is invalid or unavailable for this layout",
            );
        }
        if !seen.insert(binding.column) {
            setting_loss(
                losses,
                ViewSetting::Other,
                &path,
                "Repeated property omitted",
            );
            continue;
        }
        result.push(ViewColumn {
            column: binding.column,
            width: if kind == ViewType::Table {
                width_px
            } else {
                None
            },
        });
    }
    result
}

fn remaining(
    object: &serde_json::Map<String, Value>,
    consumed: &[&str],
    path: &str,
    context: ViewSetting,
    losses: &mut Vec<ViewLoss>,
) {
    for (key, value) in object {
        if !consumed.contains(&key.as_str()) && !value.is_null() {
            setting_loss(
                losses,
                if context == ViewSetting::Grouping {
                    context
                } else {
                    setting_kind(key)
                },
                &format!("{path}.{key}"),
                "Setting has no Macro equivalent",
            );
        }
    }
}
