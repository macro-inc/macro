use std::sync::{Arc, Mutex};

use super::*;

#[derive(Default)]
struct RecordingLookup {
    calls: Arc<Mutex<Vec<(String, EntityType)>>>,
    expanded_sources: Arc<Mutex<Vec<EntityAccessSource>>>,
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

    async fn users_for_sources(
        &self,
        sources: &[EntityAccessSource],
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        self.expanded_sources
            .lock()
            .expect("sources lock")
            .extend_from_slice(sources);
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
        ..Default::default()
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

#[tokio::test]
async fn expands_recorded_grants_through_the_lookup() {
    let expanded_sources = Arc::new(Mutex::new(Vec::new()));
    let adapter = EntityAccessExpander::new(RecordingLookup {
        expanded_sources: expanded_sources.clone(),
        users: vec![user("macro|one@example.com")],
        ..Default::default()
    });
    let team = EntityAccessSource {
        source_type: entity_access::domain::models::EntityAccessSourceType::Team,
        source_id: "00000000-0000-0000-0000-0000000000aa".to_string(),
    };

    let users = adapter
        .expand_sources(std::slice::from_ref(&team))
        .await
        .expect("source expansion succeeds");

    assert_eq!(users, vec![user("macro|one@example.com")]);
    assert_eq!(
        expanded_sources.lock().expect("sources lock").as_slice(),
        &[team]
    );
}
