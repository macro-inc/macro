use std::collections::{HashMap, HashSet};
use std::future::ready;
use std::sync::Mutex;

use super::*;
use crate::domain::create::{MarkdownSubtype, NewDocumentMetadata};
use crate::domain::models::PropertyInput;
use models_properties::api::SetPropertyValue;
const PRIORITY_PROPERTY: Uuid = Uuid::from_u128(100);
const INITIAL_PRIORITY: Uuid = Uuid::from_u128(101);
const EDITED_PRIORITY: Uuid = Uuid::from_u128(102);

#[derive(Default)]
struct FakeStore {
    priorities: HashMap<Uuid, Uuid>,
    tags: HashSet<Uuid>,
    fail_create: HashSet<Uuid>,
    fail_tag: HashSet<Uuid>,
    calls: Vec<(Uuid, &'static str)>,
}

fn documents() -> Vec<(Uuid, NewMarkdownTextDocument)> {
    (1..=3)
        .map(|n| {
            let id = Uuid::from_u128(n);
            (
                id,
                NewMarkdownTextDocument {
                    metadata: NewDocumentMetadata::builder("starter").id(id).build(),
                    markdown: id.to_string(),
                    subtype: MarkdownSubtype::Task {
                        property_values: Some(vec![PropertyInput {
                            property_id: PRIORITY_PROPERTY.to_string(),
                            value: SetPropertyValue::SelectOption {
                                option_id: INITIAL_PRIORITY,
                            },
                        }]),
                        share_with_team: false,
                        team_id: None,
                    },
                },
            )
        })
        .collect()
}

async fn seed(store: &Mutex<FakeStore>) -> StarterDocumentsOutcome {
    seed_starter_documents(
        documents(),
        |document| {
            let mut store = store.lock().unwrap();
            let id = Uuid::parse_str(&document.markdown).unwrap();
            store.calls.push((id, "create"));
            let result = if store.fail_create.contains(&id) {
                Err(DocumentError::Internal(anyhow::anyhow!(
                    "create unavailable"
                )))
            } else if store.priorities.contains_key(&id) {
                Err(DocumentError::Conflict("already exists".into()))
            } else {
                let MarkdownSubtype::Task {
                    property_values: Some(properties),
                    ..
                } = document.subtype
                else {
                    panic!("expected task")
                };
                let SetPropertyValue::SelectOption { option_id } = properties[0].value else {
                    panic!("expected priority")
                };
                store.priorities.insert(id, option_id);
                Ok(())
            };
            ready(result)
        },
        |id| {
            let mut store = store.lock().unwrap();
            store.calls.push((id, "tag"));
            let result = if store.fail_tag.contains(&id) {
                Err(DocumentError::Internal(anyhow::anyhow!("tag unavailable")))
            } else {
                store.tags.insert(id);
                Ok(())
            };
            ready(result)
        },
    )
    .await
}

#[tokio::test]
async fn tag_failure_does_not_block_content_and_retry_preserves_edited_priority() {
    let first_id = Uuid::from_u128(1);
    let store = Mutex::new(FakeStore {
        fail_tag: HashSet::from([first_id]),
        ..Default::default()
    });
    let first = seed(&store).await;
    assert!(first.incomplete);
    assert_eq!(first.available.len(), 3);
    assert_eq!(first.created.len(), 3);
    {
        let mut store = store.lock().unwrap();
        assert_eq!(
            store.calls,
            vec![
                (first_id, "create"),
                (first_id, "tag"),
                (Uuid::from_u128(2), "create"),
                (Uuid::from_u128(2), "tag"),
                (Uuid::from_u128(3), "create"),
                (Uuid::from_u128(3), "tag"),
            ]
        );
        store.priorities.insert(first_id, EDITED_PRIORITY);
        store.fail_tag.clear();
    }
    let retried = seed(&store).await;
    assert!(!retried.incomplete);
    assert!(retried.created.is_empty());
    assert_eq!(retried.available.len(), 3);
    let store = store.lock().unwrap();
    assert_eq!(store.tags.len(), 3);
    assert_eq!(store.priorities[&first_id], EDITED_PRIORITY);
}

#[tokio::test]
async fn create_failure_does_not_tag_missing_document_or_block_later_documents() {
    let first_id = Uuid::from_u128(1);
    let store = Mutex::new(FakeStore {
        fail_create: HashSet::from([first_id]),
        ..Default::default()
    });
    let result = seed(&store).await;
    assert!(result.incomplete);
    assert_eq!(result.available.len(), 2);
    assert!(!result.available.contains(&first_id));
    let store = store.lock().unwrap();
    assert!(!store.calls.contains(&(first_id, "tag")));
    assert_eq!(store.tags.len(), 2);
}
