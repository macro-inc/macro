//! Expands changes that affect neighboring tasks' dependency projections.

#[cfg(test)]
mod test;

use super::*;
use uuid::Uuid;

fn dependency_property(property_id: Uuid) -> bool {
    matches!(
        property_id,
        SystemPropertyKey::STATUS_UUID
            | SystemPropertyKey::DEPENDS_ON_UUID
            | SystemPropertyKey::BLOCKING_UUID
    )
}

fn relationship_references(value: &Option<PropertyValue>, patches: &mut Vec<SoupRealtimePatch>) {
    if let Some(PropertyValue::EntityRef(references)) = value {
        for reference in references {
            if matches!(
                reference.entity_type,
                PropertyEntityType::Task | PropertyEntityType::Document
            ) {
                push_unique_update(patches, EntityType::Document, &reference.entity_id);
            }
        }
    }
}

pub(super) async fn expand(
    neighbors: &impl TaskDependencyNeighbors,
    event: &DeclaredMacroEvent,
    patches: &mut Vec<SoupRealtimePatch>,
) -> Result<(), Report> {
    let mut task_ids = Vec::new();
    let mut only_task_roots = false;
    match event {
        DeclaredMacroEvent::PropertyMacroEvent(event) => match &event.event().event {
            PropertyTopicEvent::EntityPropertyUpdated(metadata)
                if matches!(
                    metadata.entity_type,
                    PropertyEntityType::Task | PropertyEntityType::Document
                ) && dependency_property(metadata.property_definition_id) =>
            {
                if metadata.property_definition_id == SystemPropertyKey::STATUS_UUID {
                    task_ids.push(metadata.entity_id.as_str());
                } else if metadata.previous_value.is_none() {
                    // Current writers publish canonical reciprocal events. Expand
                    // only legacy events, avoiding quadratic reciprocal fanout.
                    task_ids.push(metadata.entity_id.as_str());
                    relationship_references(&metadata.value, patches);
                }
            }
            PropertyTopicEvent::EntityPropertyDeleted(metadata)
                if matches!(
                    metadata.entity_type,
                    PropertyEntityType::Task | PropertyEntityType::Document
                ) && dependency_property(metadata.property_definition_id) =>
            {
                task_ids.push(metadata.entity_id.as_str());
                // Deletes before reciprocal support did not retain old references.
                // Dependency deletes now publish a cleared update with its old snapshot.
            }
            PropertyTopicEvent::EntityPropertiesCleared(metadata)
                if matches!(
                    metadata.entity_type,
                    PropertyEntityType::Task | PropertyEntityType::Document
                ) =>
            {
                task_ids.push(metadata.entity_id.as_str());
            }
            _ => {}
        },
        DeclaredMacroEvent::DocumentMacroEvent(event) => match &event.event().event {
            // Restorations use Updated, which has no dedicated restoration marker.
            DocumentTopicEvent::Updated(metadata) => {
                only_task_roots = true;
                task_ids.push(&metadata.document_id);
            }
            DocumentTopicEvent::Deleted(metadata) => task_ids.push(&metadata.document_id),
            DocumentTopicEvent::EmailAttachmentsReleased(metadata) => {
                task_ids.extend(metadata.trashed_document_ids.iter().map(String::as_str));
            }
            _ => {}
        },
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            if let ProjectTopicEvent::Deleted(metadata) = &event.event().event {
                task_ids.extend(metadata.deleted_document_ids.iter().map(String::as_str));
            }
        }
        _ => {}
    }
    let task_ids = task_ids
        .into_iter()
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut seen = patches
        .iter()
        .map(|patch| patch.patch.value().clone())
        .collect::<std::collections::HashSet<_>>();
    for batch in task_ids.chunks(500) {
        for neighbor in neighbors.neighbors(batch, only_task_roots).await? {
            // Deleted tasks must not receive Updated through a cycle.
            if seen.insert(neighbor.clone()) {
                patches.push(SoupRealtimePatch::for_entity(Patch::Updated(neighbor)));
            }
        }
    }
    Ok(())
}
