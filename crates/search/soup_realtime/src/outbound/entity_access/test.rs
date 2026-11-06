use std::sync::{Arc, Mutex};

use super::*;

struct RecordingLookup {
    calls: Arc<Mutex<Vec<(String, EntityType)>>>,
    users: Vec<MacroUserIdStr<'static>>,
}

impl EntityAccessUserLookup for RecordingLookup {
    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        self.calls
            .lock()
            .expect("calls lock")
            .push((entity_id.to_string(), entity_type));
        Ok(self.users.clone())
    }
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

#[tokio::test]
async fn forwards_entity_and_returns_underlying_users() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let adapter = EntityAccessExpander::new(RecordingLookup {
        calls: calls.clone(),
        users: vec![user("macro|one@example.com"), user("macro|two@example.com")],
    });
    let entity =
        EntityType::Document.with_entity_string("00000000-0000-0000-0000-000000000001".to_string());

    let users = adapter
        .expand_user_access(&entity)
        .await
        .expect("access expansion succeeds");

    assert_eq!(users.len(), 2);
    assert_eq!(users[0].as_ref(), "macro|one@example.com");
    assert_eq!(users[1].as_ref(), "macro|two@example.com");
    assert_eq!(
        calls.lock().expect("calls lock").as_slice(),
        &[(entity.entity_id.to_string(), EntityType::Document)]
    );
}
