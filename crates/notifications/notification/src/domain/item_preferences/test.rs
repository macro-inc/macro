use super::*;
use chrono::Duration;
use entity_kind::EntityType;
use std::sync::Mutex;

#[derive(Default)]
struct FakeRepository {
    writes: Mutex<Vec<(String, Option<DateTime<Utc>>)>>,
    bulk: Mutex<Vec<(String, Vec<String>, Option<DateTime<Utc>>)>>,
    removals: Mutex<Vec<(String, Vec<String>)>>,
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
    async fn set_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
        until: Option<DateTime<Utc>>,
    ) -> Result<(), Report> {
        self.bulk.lock().unwrap().push((
            user.to_string(),
            entities.iter().map(|e| e.entity_id.to_string()).collect(),
            until,
        ));
        Ok(())
    }
    async fn remove_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<(), Report> {
        self.removals.lock().unwrap().push((
            user.to_string(),
            entities.iter().map(|e| e.entity_id.to_string()).collect(),
        ));
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

#[tokio::test]
async fn bulk_validates_before_writing_and_deduplicates() {
    let service = ItemNotificationPreferenceService::new(FakeRepository::default());
    let owner = || MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let now = Utc::now();
    let items = || {
        vec![
            EntityType::Channel.with_entity_string("same".to_owned()),
            EntityType::Channel.with_entity_string("same".to_owned()),
            EntityType::Document.with_entity_string("other".to_owned()),
        ]
    };
    assert!(matches!(
        service.set_bulk(owner(), items(), Some(now), now).await,
        Err(ItemNotificationPreferenceError::InvalidDeadline)
    ));
    assert!(matches!(
        service
            .remove_bulk(
                owner(),
                vec![EntityType::Channel.with_entity_string("id".to_owned()); 501]
            )
            .await,
        Err(ItemNotificationPreferenceError::TooManyItems)
    ));
    assert!(matches!(
        service
            .set_bulk(
                owner(),
                vec![
                    EntityType::Channel.with_entity_string("same".to_owned()),
                    EntityType::Document.with_entity_string("same".to_owned()),
                ],
                None,
                now
            )
            .await,
        Err(ItemNotificationPreferenceError::ConflictingTypes)
    ));
    assert!(service.repository.bulk.lock().unwrap().is_empty());
    assert!(service.repository.removals.lock().unwrap().is_empty());
    let future = now + Duration::hours(1);
    service
        .set_bulk(owner(), items(), Some(future), now)
        .await
        .unwrap();
    service.set_bulk(owner(), items(), None, now).await.unwrap();
    service.remove_bulk(owner(), items()).await.unwrap();
    let writes = service.repository.bulk.lock().unwrap();
    assert_eq!(writes.len(), 2);
    assert_eq!(
        writes[0],
        (
            "macro|owner@example.com".to_owned(),
            vec!["same".to_owned(), "other".to_owned()],
            Some(future)
        )
    );
    assert_eq!(writes[1].2, None);
    assert_eq!(
        service.repository.removals.lock().unwrap()[0].1,
        vec!["same", "other"]
    );
}
