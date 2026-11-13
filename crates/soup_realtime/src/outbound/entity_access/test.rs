use std::sync::{Arc, Mutex};

use entity_access::domain::models::{AccessError, EntityAudience};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[derive(Clone)]
struct RecordingLookup {
    calls: Arc<Mutex<Vec<(EntityType, Vec<String>)>>>,
    users: Vec<MacroUserIdStr<'static>>,
}

impl EntityAudienceLookup for RecordingLookup {
    async fn get_entity_audiences(
        &self,
        entity_type: EntityType,
        entity_ids: &[&str],
    ) -> Result<Vec<EntityAudience>, AccessError> {
        let entity_ids = entity_ids
            .iter()
            .map(|entity_id| entity_id.to_string())
            .collect::<Vec<_>>();
        self.calls
            .lock()
            .expect("calls lock")
            .push((entity_type, entity_ids.clone()));
        Ok(vec![EntityAudience {
            entity_ids,
            users: self.users.clone(),
        }])
    }
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

#[tokio::test]
async fn looks_up_each_entity_type_once_and_returns_its_shared_access() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let users = vec![user("macro|one@example.com"), user("macro|two@example.com")];
    let adapter = EntityAccessExpander::new(RecordingLookup {
        calls: calls.clone(),
        users: users.clone(),
    });
    let first_document =
        EntityType::Document.with_entity_string("00000000-0000-0000-0000-000000000001".to_string());
    let folder =
        EntityType::Project.with_entity_string("00000000-0000-0000-0000-000000000002".to_string());
    let second_document =
        EntityType::Document.with_entity_string("00000000-0000-0000-0000-000000000003".to_string());

    let shared_access = adapter
        .expand_user_access(&[
            first_document.clone(),
            folder.clone(),
            second_document.clone(),
        ])
        .await
        .expect("access expansion succeeds");

    assert_eq!(
        shared_access,
        vec![
            SharedAccess {
                entities: vec![first_document, second_document],
                users: users.clone(),
            },
            SharedAccess {
                entities: vec![folder],
                users,
            },
        ]
    );
    assert_eq!(
        calls.lock().expect("calls lock").as_slice(),
        &[
            (
                EntityType::Document,
                vec![
                    "00000000-0000-0000-0000-000000000001".to_string(),
                    "00000000-0000-0000-0000-000000000003".to_string(),
                ]
            ),
            (
                EntityType::Project,
                vec!["00000000-0000-0000-0000-000000000002".to_string()]
            ),
        ]
    );
}
