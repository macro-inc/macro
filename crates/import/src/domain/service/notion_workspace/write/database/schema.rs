//! Compact reserved schema facts: structural identity, date shapes and option mappings.

use super::*;
use models_databases::OptionId;
use serde::{Deserialize, Serialize};

/// Names and option labels may drift; only stable property identity/kind is structural.
pub(super) fn fingerprint(source: &NotionDataSource, database: Uuid) -> anyhow::Result<Uuid> {
    let mut properties = source
        .properties
        .iter()
        .map(|property| {
            let kind = serde_json::to_value(&property.kind)?;
            Ok((
                property.id.as_str(),
                kind.get("type").cloned().unwrap_or(kind),
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    properties.sort_by(|a, b| a.0.cmp(b.0));
    Ok(derived_id(
        database,
        &format!("schema/{}", serde_json::to_string(&properties)?),
    ))
}

#[derive(Serialize, Deserialize)]
struct ReservedOption {
    property: String,
    notion_id: Option<String>,
    label: String,
    order: usize,
}

/// Record the exact mappings used to create the schema, before applying operations.
pub(super) fn option_markers(
    plan: &ColumnPlan,
    import_id: Uuid,
) -> anyhow::Result<Vec<WrittenObject>> {
    let mut markers = Vec::new();
    for column in &plan.columns {
        let ColumnShape::Select { options, .. } = &column.shape else {
            continue;
        };
        for (order, (id, label)) in options.iter().enumerate() {
            let mut notion_ids: Vec<_> = column
                .option_ids
                .iter()
                .filter(|(_, known)| *known == id)
                .map(|(id, _)| Some(id.clone()))
                .collect();
            if notion_ids.is_empty() {
                notion_ids.push(None);
            }
            for notion_id in notion_ids {
                markers.push(WrittenObject {
                    import_id,
                    kind: WrittenKind::ColumnOption,
                    object: serde_json::to_string(&ReservedOption {
                        property: column.property_id.clone(),
                        notion_id,
                        label: label.clone(),
                        order,
                    })?,
                    macro_id: id.into_uuid(),
                });
            }
        }
    }
    Ok(markers)
}

/// Reuse reserved options, including an originally empty option list.
pub(super) fn restore_options<Store: WrittenObjects>(
    plan: &mut ColumnPlan,
    progress: &Progress<'_, Store>,
) -> anyhow::Result<()> {
    let facts = progress
        .all(WrittenKind::ColumnOption)
        .into_iter()
        .map(|(payload, id)| {
            Ok((
                serde_json::from_str::<ReservedOption>(&payload)?,
                OptionId::from_uuid(id),
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    for column in &mut plan.columns {
        let ColumnShape::Select { options, .. } = &mut column.shape else {
            continue;
        };
        column.option_ids.clear();
        options.clear();
        let mut matching: Vec<_> = facts
            .iter()
            .filter(|(fact, _)| fact.property == column.property_id)
            .collect();
        matching.sort_by_key(|(fact, _)| fact.order);
        for (fact, id) in matching {
            if !options.iter().any(|(known, _)| known == id) {
                options.push((*id, fact.label.clone()));
            }
            if let Some(notion_id) = &fact.notion_id {
                column.option_ids.insert(notion_id.clone(), *id);
            }
        }
    }
    Ok(())
}
