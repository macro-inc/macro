use super::*;
use std::sync::Mutex;

struct Neighbors {
    results: Vec<Entity<'static>>,
    batches: Mutex<Vec<usize>>,
}
impl TaskDependencyNeighbors for Neighbors {
    async fn neighbors(&self, ids: &[Uuid]) -> Result<Vec<Entity<'static>>, Report> {
        self.batches.lock().unwrap().push(ids.len());
        Ok(self.results.clone())
    }
}

#[tokio::test]
async fn canonical_relationship_events_avoid_fanout_and_legacy_status_events_use_each_tasks_audience()
 {
    let task = Uuid::now_v7();
    let related = Uuid::now_v7();
    for (key, canonical) in [
        (SystemPropertyKey::DEPENDS_ON_UUID, false),
        (SystemPropertyKey::DEPENDS_ON_UUID, true),
        (SystemPropertyKey::BLOCKING_UUID, false),
        (SystemPropertyKey::BLOCKING_UUID, true),
        (SystemPropertyKey::STATUS_UUID, false),
    ] {
        let previous = if !canonical {
            None
        } else {
            Some(PropertyValue::EntityRef(vec![
                models_properties::EntityReference::new(
                    related.to_string(),
                    PropertyEntityType::Task,
                ),
            ]))
        };
        let event = PropertyMacroEvent::entity_property_updated(
            properties::domain::events::EntityPropertyUpdatedMetadata {
                entity_property_id: Uuid::now_v7(),
                entity_id: task.to_string(),
                entity_type: PropertyEntityType::Task,
                property_definition_id: key,
                actor_user_id: None,
                actor: None,
                on_behalf_of: None,
                source: None,
                inherited_from_project: None,
                value: if canonical || key == SystemPropertyKey::STATUS_UUID {
                    None
                } else {
                    Some(PropertyValue::EntityRef(vec![
                        models_properties::EntityReference::new(
                            related.to_string(),
                            PropertyEntityType::Task,
                        ),
                    ]))
                },
                previous_value: previous,
                updated_at: chrono::Utc::now(),
            },
        );
        let lookup = Neighbors {
            results: if key == SystemPropertyKey::STATUS_UUID {
                vec![entity(EntityType::Document, related)]
            } else {
                vec![]
            },
            batches: Mutex::new(vec![]),
        };
        let mut patches = vec![update(EntityType::Document, task)];
        expand(
            &lookup,
            &DeclaredMacroEvent::PropertyMacroEvent(event),
            &mut patches,
        )
        .await
        .unwrap();
        assert_eq!(patches.len(), if canonical { 1 } else { 2 });
        if canonical {
            assert!(lookup.batches.lock().unwrap().is_empty());
            continue;
        }
        let target = patches
            .iter()
            .find(|patch| patch.patch.value().entity_id == related.to_string())
            .unwrap();
        assert_eq!(
            target.access_source,
            Some(entity(EntityType::Document, related))
        );
    }
}

#[tokio::test]
async fn deleted_tasks_do_not_resurrect_through_cycles_and_folder_lookups_are_batched() {
    let task = Uuid::now_v7();
    let related = Uuid::now_v7();
    let lookup = Neighbors {
        results: vec![
            entity(EntityType::Document, task),
            entity(EntityType::Document, related),
            entity(EntityType::Document, related),
        ],
        batches: Mutex::new(vec![]),
    };
    let event = DocumentMacroEvent::deleted(
        task.to_string(),
        documents::domain::events::DocumentDeletedMetadata {
            document_id: task.to_string(),
            sub_type: None,
            actor_user_id: None,
            actor: None,
            on_behalf_of: None,
            project_id: None,
        },
    );
    let mut patches = vec![delete(EntityType::Document, task)];
    expand(
        &lookup,
        &DeclaredMacroEvent::DocumentMacroEvent(event),
        &mut patches,
    )
    .await
    .unwrap();
    assert_eq!(patches.len(), 2);
    assert!(matches!(patches[0].patch, Patch::Deleted(_)));
    assert_eq!(
        patches[1].access_source,
        Some(entity(EntityType::Document, related))
    );

    let lookup = Neighbors {
        results: vec![],
        batches: Mutex::new(vec![]),
    };
    let folder = Uuid::now_v7();
    let event = ProjectMacroEvent::deleted(
        folder.to_string(),
        projects::domain::events::ProjectDeletedMetadata {
            project_id: folder.to_string(),
            owner: model_owner::Owner::Team(Uuid::now_v7()),
            actor_user_id: None,
            parent_project_id: None,
            deleted_project_ids: vec![folder.to_string()],
            deleted_document_ids: (0..1001).map(|_| Uuid::now_v7().to_string()).collect(),
            deleted_chat_ids: vec![],
        },
    );
    expand(
        &lookup,
        &DeclaredMacroEvent::ProjectMacroEvent(event),
        &mut vec![],
    )
    .await
    .unwrap();
    assert_eq!(*lookup.batches.lock().unwrap(), vec![500, 500, 1]);
}
