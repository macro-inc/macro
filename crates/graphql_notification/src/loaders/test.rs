use super::*;
use std::sync::Mutex;

use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use chrono::Utc;
use notification::domain::models::NotificationState;
use uuid::Uuid;

fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("loader@test.com").unwrap()
}

#[tokio::test]
async fn schema_reader_preserves_canonical_entity_keys() {
    let keys = vec![
        model_entity::EntityType::CrmCompany.with_entity_string("company-1".to_owned()),
        model_entity::EntityType::Document.with_entity_string("document-1".to_owned()),
        model_entity::EntityType::ForeignEntity.with_entity_string("foreign-1".to_owned()),
    ];
    let result = NoOpSoupNotificationEdgeReader
        .get_notifications(test_user(), keys.clone(), Default::default())
        .await
        .unwrap();
    assert_eq!(result.len(), keys.len());
    assert!(keys.iter().all(|key| result[key].is_empty()));
}

#[derive(Clone)]
struct Reader(
    Arc<
        Mutex<
            Vec<(
                String,
                Vec<model_entity::Entity<'static>>,
                EntityNotificationQuery,
            )>,
        >,
    >,
);

impl SoupNotificationEdgeReader for Reader {
    async fn get_notifications(
        &self,
        user: MacroUserIdStr<'static>,
        keys: Vec<model_entity::Entity<'static>>,
        query: EntityNotificationQuery,
    ) -> Result<
        HashMap<model_entity::Entity<'static>, Vec<UserNotificationRow<NotifEvent>>>,
        rootcause::Report,
    > {
        self.0
            .lock()
            .unwrap()
            .push((user.to_string(), keys.clone(), query.clone()));
        Ok(keys.into_iter().map(|key| {
            let rows = [NotificationState::Seen, NotificationState::Unseen].into_iter()
                .filter(|state| query.states.contains(state))
                .take(query.limit.unwrap_or(u32::MAX) as usize)
                .map(|state| UserNotificationRow {
                    owner_id: user.clone(), notification_id: Uuid::now_v7(),
                    notification_event_type: "task_assigned".into(), entity: key.clone(),
                    sent: true, state, created_at: Utc::now(), updated_at: Utc::now(),
                    viewed_at: None, deleted_at: None, sender_id: None,
                    notification_metadata: serde_json::json!({"taskId":"task", "assignedBy":"macro|sender@example.com"}),
                }.into_tagged().deserialize_metadata().unwrap()).collect();
            (key, rows)
        }).collect())
    }
}

struct Query;
#[Object]
impl Query {
    async fn notifications(
        &self,
        ctx: &async_graphql::Context<'_>,
        entity: String,
        filter: Option<crate::GraphqlNotificationFilter>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<crate::GraphqlNotification>> {
        crate::load_entity_notifications::<Reader>(
            ctx,
            model_entity::EntityType::Channel.with_entity_string(entity),
            filter,
            limit,
        )
        .await
    }
}

#[tokio::test]
async fn aliases_and_entities_batch_without_mixing_full_and_limited_results() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(entity_notifications_loader(
            test_user(),
            Reader(calls.clone()),
        ))
        .finish();
    let response = schema
        .execute(
            r#"{
        full: notifications(entity: "one") { id state }
        unread: notifications(entity: "one", filter: {states: [UNSEEN]}, limit: 1) { id state }
        other: notifications(entity: "two", filter: {states: [UNSEEN]}, limit: 1) { id state }
    }"#,
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let json = response.data.into_json().unwrap();
    assert_eq!(json["full"].as_array().unwrap().len(), 2);
    assert_eq!(json["unread"].as_array().unwrap().len(), 1);
    assert_eq!(json["unread"][0]["state"], "UNSEEN");
    assert_eq!(json["other"].as_array().unwrap().len(), 1);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 2, "one batch per selection, not per entity");
    assert!(
        calls
            .iter()
            .all(|(user, _, _)| user == test_user().as_ref())
    );
    assert_eq!(
        calls
            .iter()
            .find(|(_, _, query)| query.limit == Some(1))
            .unwrap()
            .1
            .len(),
        2
    );
}

#[tokio::test]
async fn invalid_limits_do_not_reach_the_reader() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(entity_notifications_loader(
            test_user(),
            Reader(calls.clone()),
        ))
        .finish();
    for limit in [-1, 0, 501] {
        let response = schema
            .execute(format!(
                "{{ notifications(entity: \"one\", limit: {limit}) {{ id }} }}"
            ))
            .await;
        assert!(!response.errors.is_empty());
    }
    assert!(calls.lock().unwrap().is_empty());
}
