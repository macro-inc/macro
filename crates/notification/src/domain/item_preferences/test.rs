use super::*;
use chrono::Duration;
use model_entity::EntityType;
use std::sync::Mutex;

#[derive(Default)]
struct FakeRepository {
    writes: Mutex<Vec<(String, Option<DateTime<Utc>>)>>,
}

impl ItemNotificationPreferenceRepository for FakeRepository {
    async fn list(&self, _: MacroUserIdStr<'_>) -> Result<Vec<ItemNotificationPreference>, Report> {
        Ok(vec![])
    }
    async fn set(
        &self,
        user: MacroUserIdStr<'_>,
        _: Entity<'_>,
        until: Option<DateTime<Utc>>,
    ) -> Result<(), Report> {
        self.writes.lock().unwrap().push((user.to_string(), until));
        Ok(())
    }
    async fn remove(&self, _: MacroUserIdStr<'_>, _: Entity<'_>) -> Result<(), Report> {
        Ok(())
    }
}

#[tokio::test]
async fn only_future_deadlines_are_saved_for_the_authenticated_user() {
    let service = ItemNotificationPreferenceService::new(FakeRepository::default());
    let now = Utc::now();
    for until in [now - Duration::seconds(1), now] {
        let result = service
            .set(
                MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                EntityType::Document.with_entity_str("document"),
                Some(until),
                now,
            )
            .await;
        assert!(matches!(
            result,
            Err(ItemNotificationPreferenceError::InvalidDeadline)
        ));
    }
    assert!(service.repository.writes.lock().unwrap().is_empty());
    for until in [Some(now + Duration::hours(1)), None] {
        service
            .set(
                MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                EntityType::Document.with_entity_str("document"),
                until,
                now,
            )
            .await
            .unwrap();
    }
    let writes = service.repository.writes.lock().unwrap();
    assert_eq!(writes.len(), 2);
    assert!(
        writes
            .iter()
            .all(|(user, _)| user == "macro|owner@example.com")
    );
    assert!(writes[0].1.is_some());
    assert!(writes[1].1.is_none());
}
