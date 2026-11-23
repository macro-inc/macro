//! Current CRM visibility across an open subscription and retained session activity.
use super::*;
use activity::{
    ActivityRecord, ActivitySubscription, ActivitySubscriptionExit, ActivitySubscriptionService,
    ActivitySubscriptionUpdate,
    domain::ports::{ActivityFeedPage, AgentActivityReads},
};
use async_graphql::{EmptyMutation, Object, Schema, futures_util::StreamExt};
use std::num::NonZeroU32;

fn crm_records() -> Vec<ActivityRecord> {
    [
        EntityType::CrmCompany,
        EntityType::CrmContact,
        EntityType::CrmPipeline,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, entity_type)| ActivityRecord {
        id: Uuid::from_u128(index as u128 + 1),
        actor: activity::Actor::new_from_user(
            MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        ),
        subject_id: VALID_USER_ID.into(),
        entity_type,
        entity_id: Uuid::from_u128(index as u128 + 11).to_string(),
        action: activity::RecordedAction::Known(activity::Action::Edited),
        occurred_at: chrono::Utc::now(),
        agent_correlation_id: None,
        agent_verb: None,
    })
    .collect()
}

fn set_access(access: &CountingEntityAccessService, enabled: bool, keep_pipeline: bool) {
    *access.viewable_crm_records.lock().unwrap() = crm_records()
        .into_iter()
        .filter(|row| enabled || (keep_pipeline && row.entity_type == EntityType::CrmPipeline))
        .map(|row| (row.entity_type, row.entity_id))
        .collect();
}

struct Query;
#[Object]
impl Query {
    async fn ready(&self) -> bool {
        true
    }
}

struct SubscriptionService(Mutex<Option<ActivitySubscription>>);
impl ActivitySubscriptionService for SubscriptionService {
    fn subscribe(&self, _: MacroUserIdStr<'static>) -> ActivitySubscription {
        self.0.lock().unwrap().take().unwrap()
    }
}

#[tokio::test]
async fn open_graphql_subscription_rechecks_crm_access_after_revocation_and_regrant() {
    let access = Arc::new(CountingEntityAccessService::default());
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let (exit_sender, exit_receiver) = tokio::sync::oneshot::channel();
    exit_sender.send(ActivitySubscriptionExit::Closed).unwrap();
    let service = SubscriptionService(Mutex::new(Some(ActivitySubscription::from_parts(
        receiver,
        exit_receiver,
    ))));
    let schema = Schema::build(
        Query,
        EmptyMutation,
        graphql_activity::ActivitySubscriptionRoot::<
            _,
            CountingEntityAccessService,
            Arc<CountingEntityAccessService>,
        >::new(service),
    )
    .data(access.clone())
    .finish();
    let request = async_graphql::Request::new(
        "subscription { activityUpdates { __typename ... on GraphqlActivityEvent { id } ... on GraphqlActivityInvalidation { refresh } } }",
    )
    .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap());
    let mut responses = Box::pin(schema.execute_stream(request));
    for enabled in [true, false, true] {
        // Queue while permitted, then revoke before consuming the next frame.
        set_access(&access, true, false);
        for row in crm_records() {
            let id = row.id;
            sender
                .send(ActivitySubscriptionUpdate::Updated(Arc::new(row)))
                .await
                .unwrap();
            if enabled {
                let response = responses.next().await.unwrap();
                assert!(response.errors.is_empty(), "{:?}", response.errors);
                assert_eq!(
                    response.data.into_json().unwrap()["activityUpdates"]["id"],
                    id.to_string()
                );
            }
        }
        set_access(&access, enabled, false);
        sender
            .send(ActivitySubscriptionUpdate::Invalidated)
            .await
            .unwrap();
        let response = responses.next().await.unwrap();
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.into_json().unwrap()["activityUpdates"]["refresh"],
            true,
            "denied CRM events must not precede the content-free signal"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn open_session_subscription_rechecks_queued_crm_events(pool: sqlx::PgPool) {
    use activity::{ActivityTopicEvent, ActivityTopicEventConsumer, ActivityWireRow};

    struct Consumer(tokio::sync::Mutex<tokio::sync::mpsc::Receiver<ActivityTopicEvent>>);
    impl ActivityTopicEventConsumer for Consumer {
        async fn recv(&self) -> Result<ActivityTopicEvent, Report> {
            self.0
                .lock()
                .await
                .recv()
                .await
                .ok_or_else(|| rootcause::report!("closed"))
        }
    }
    let session_id = Uuid::now_v7();
    let correlation_id = Uuid::now_v7();
    let bot_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, status) VALUES ($1, $2, $3, 'test', 'test', '/workspace', 'disconnected')",
        session_id, VALID_USER_ID, bot_id,
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO agent_correlations (id, agent_session_id) VALUES ($1, $2)",
        correlation_id,
        session_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let consumer = Arc::new(activity::ActivityRealtimeConsumerService::new(Consumer(
        tokio::sync::Mutex::new(receiver),
    )));
    let subscriptions = crate::agent_session_activity_subscriptions(consumer.clone(), pool);
    let harness = harness();
    harness
        .primary_soup_service
        .set_raw_response(vec![soup_agent_session(session_id)]);
    let request = harness.request(
        &format!("subscription {{ agentSessionActivityAppended(sessionId: \"{session_id}\") {{ id entityType }} }}"),
        authenticated_parts(),
    ).data(subscriptions);
    let mut responses = Box::pin(harness.schema.execute_stream(request));
    let ready = responses.next().await.unwrap();
    assert!(ready.errors.is_empty(), "{:?}", ready.errors);
    assert_eq!(
        ready.data.into_json().unwrap()["agentSessionActivityAppended"],
        serde_json::json!([])
    );
    let worker = tokio::spawn(async move { consumer.run().await });
    for enabled in [true, false, true] {
        set_access(&harness.state.entity_access, true, true);
        let rows: Vec<_> = crm_records()
            .into_iter()
            .map(|mut record| {
                record.agent_correlation_id = Some(correlation_id);
                ActivityWireRow::from(record)
            })
            .collect();
        let expected: Vec<_> = rows
            .iter()
            .filter(|row| enabled || row.entity_type == EntityType::CrmPipeline)
            .map(|row| row.id.to_string())
            .collect();
        sender
            .send(ActivityTopicEvent::SessionRecorded { activities: rows })
            .await
            .unwrap();
        // This same stream retains session access and an independent pipeline grant.
        set_access(&harness.state.entity_access, enabled, true);
        for id in expected {
            let response =
                tokio::time::timeout(std::time::Duration::from_secs(3), responses.next())
                    .await
                    .unwrap()
                    .unwrap();
            assert!(response.errors.is_empty(), "{:?}", response.errors);
            assert_eq!(
                response.data.into_json().unwrap()["agentSessionActivityAppended"][0]["id"],
                id
            );
        }
    }
    worker.abort();
}

struct SessionActivity;
impl AgentActivityReads for SessionActivity {
    type Err = std::io::Error;
    async fn agent_activity(
        &self,
        _: Uuid,
        _: Option<Uuid>,
        cursor: Option<(chrono::DateTime<chrono::Utc>, Uuid)>,
        _: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        Ok(ActivityFeedPage {
            records: crm_records(),
            next: cursor,
        })
    }
}

#[tokio::test]
async fn session_activity_requires_current_crm_access_but_keeps_an_individual_pipeline() {
    let access = CountingEntityAccessService::default();
    let receipt = EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        entity_access::domain::models::Entity {
            entity_id: Uuid::from_u128(100).to_string(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();
    let cursor_id = Uuid::from_u128(200);
    for enabled in [true, false, true] {
        set_access(&access, enabled, true);
        let page = agent_session::domain::activity::read(
            &SessionActivity,
            &access,
            &receipt,
            None,
            Some(agent_session::domain::activity::AgentActivityCursor {
                occurred_at: chrono::Utc::now(),
                id: cursor_id,
            }),
            NonZeroU32::new(100).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(page.next_cursor.unwrap().id, cursor_id);
        assert_eq!(page.activities.len(), if enabled { 3 } else { 1 });
        if !enabled {
            assert_eq!(page.activities[0].entity_type, EntityType::CrmPipeline);
        }
    }
}
