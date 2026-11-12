use std::sync::{Arc, Mutex};

use agent_session::domain::{
    error::AgentSessionError,
    model::AgentSessionId,
    work_registration::{WorkRegistration, WorkRegistrationChanges, WorkRegistrationId},
};
use async_graphql::futures_util::{StreamExt as _, future::BoxFuture, pin_mut};
use chrono::{DateTime, Utc};
use entity_kind::Entity;
use soup_realtime_core::models::Patch;

use super::*;
use crate::{RegisteredWorkGraphqlContext, RegisteredWorkGraphqlService};

const SESSION_ID: Uuid = Uuid::from_u128(0x5E55);
const REGISTRATION_ID: Uuid = Uuid::from_u128(0xBEEF);
const ENDED_ID: Uuid = Uuid::from_u128(0xDEAD);
const ACCOUNT: &str = "macro|registered-agent@example.com";

fn session() -> AgentSessionId {
    AgentSessionId::new_from_uuid(SESSION_ID)
}

fn registration() -> WorkRegistration {
    WorkRegistration {
        id: WorkRegistrationId::new_from_uuid(REGISTRATION_ID),
        account_id: MacroUserIdStr::parse_from_str(ACCOUNT).unwrap(),
        session: session(),
        registered_at: Utc::now(),
    }
}

/// Answers every read from fixed data, recording what it was asked.
#[derive(Clone, Default)]
struct FixedRegistrations {
    visible: Vec<WorkRegistration>,
    changes: WorkRegistrationChanges,
    read_accounts: Arc<Mutex<Vec<Vec<String>>>>,
    changed_sessions: Arc<Mutex<Vec<Vec<AgentSessionId>>>>,
}

impl RegisteredWorkGraphqlService for FixedRegistrations {
    fn visible_registrations<'a>(
        &'a self,
        _viewer: &'a MacroUserIdStr<'static>,
        accounts: &'a [MacroUserIdStr<'static>],
    ) -> BoxFuture<'a, Result<Vec<WorkRegistration>, AgentSessionError>> {
        self.read_accounts.lock().unwrap().push(
            accounts
                .iter()
                .map(|account| account.as_ref().to_owned())
                .collect(),
        );
        Box::pin(async { Ok(self.visible.clone()) })
    }

    fn changes<'a>(
        &'a self,
        _viewer: &'a MacroUserIdStr<'static>,
        _accounts: &'a [MacroUserIdStr<'static>],
        sessions: &'a [AgentSessionId],
        _ended_after: DateTime<Utc>,
    ) -> BoxFuture<'a, Result<WorkRegistrationChanges, AgentSessionError>> {
        self.changed_sessions
            .lock()
            .unwrap()
            .push(sessions.to_vec());
        Box::pin(async { Ok(self.changes.clone()) })
    }
}

/// Soup patches a test drives by hand.
#[derive(Clone, Default)]
struct ManualPatches(Arc<Mutex<Option<tokio::sync::mpsc::Sender<Patch<Entity<'static>>>>>>);

impl ManualPatches {
    async fn send(&self, patch: Patch<Entity<'static>>) {
        let sender = self.0.lock().unwrap().clone().unwrap();
        sender.send(patch).await.unwrap();
    }

    fn close(&self) {
        self.0.lock().unwrap().take();
    }
}

impl SoupRealtimeSubscriptionService for ManualPatches {
    fn subscribe(
        &self,
        _user: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>> {
        let (sender, receiver) = tokio::sync::mpsc::channel(8);
        *self.0.lock().unwrap() = Some(sender);
        receiver
    }
}

fn session_patch() -> Patch<Entity<'static>> {
    Patch::Updated(ModelEntityType::AgentSession.with_entity_string(SESSION_ID.to_string()))
}

const SUBSCRIPTION: &str = r#"subscription { registeredWorkUpdates(accountIds: ["macro|registered-agent@example.com"]) {
    __typename
    ... on GraphqlRegisteredWorkUpsert { entry { id accountId session { id name } } }
    ... on GraphqlRegisteredWorkRemove { id }
    ... on GraphqlRegisteredWorkInvalidate { refresh }
} }"#;

fn viewer_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap()
}

fn loader(items: Vec<SoupItem<()>>) -> graphql_soup::AgentSessionEntityLoader {
    let soup_service = CountingSoupService::default();
    soup_service.set_raw_response(items);
    graphql_soup::AgentSessionEntityLoader::new(
        soup_service,
        Arc::new(NoOpEmailService),
        NoOpEntityAccessService,
    )
}

fn subscription(
    service: FixedRegistrations,
    patches: &ManualPatches,
    items: Vec<SoupItem<()>>,
) -> async_graphql::Request {
    async_graphql::Request::new(SUBSCRIPTION)
        .data(viewer_id())
        .data(loader(items))
        .data(RegisteredWorkGraphqlContext::new(
            service,
            Arc::new(patches.clone()),
        ))
}

#[tokio::test]
async fn registered_work_lists_entries_hydrated_for_the_viewer() {
    let harness = harness();
    harness
        .primary_soup_service
        .set_raw_response(vec![soup_agent_session(SESSION_ID)]);
    let service = FixedRegistrations {
        visible: vec![
            registration(),
            // A session Soup does not return to this viewer is dropped, not an error.
            WorkRegistration {
                id: WorkRegistrationId::new_from_uuid(ENDED_ID),
                session: AgentSessionId::new_from_uuid(Uuid::from_u128(0x0DD)),
                ..registration()
            },
        ],
        ..FixedRegistrations::default()
    };
    let read_accounts = Arc::clone(&service.read_accounts);

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user { registeredWork(accountIds: [
                        "macro|registered-agent@example.com",
                        "macro|registered-agent@example.com"
                    ]) { id accountId session { id } } } }"#,
                    authenticated_parts(),
                )
                .data(RegisteredWorkGraphqlContext::new(
                    service,
                    Arc::new(ManualPatches::default()),
                )),
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["user"]["registeredWork"],
        serde_json::json!([{
            "id": REGISTRATION_ID.to_string(),
            "accountId": ACCOUNT,
            "session": { "id": SESSION_ID.to_string() },
        }])
    );
    assert_eq!(
        *read_accounts.lock().unwrap(),
        vec![vec![ACCOUNT.to_owned()]]
    );
}

#[tokio::test]
async fn registered_work_caps_the_accounts_one_request_may_name() {
    let harness = harness();
    let service = FixedRegistrations::default();
    let read_accounts = Arc::clone(&service.read_accounts);
    let accounts = (0..51)
        .map(|index| format!("\"macro|account-{index}@example.com\""))
        .collect::<Vec<_>>()
        .join(",");

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    &format!("{{ user {{ registeredWork(accountIds: [{accounts}]) {{ id }} }} }}"),
                    authenticated_parts(),
                )
                .data(RegisteredWorkGraphqlContext::new(
                    service,
                    Arc::new(ManualPatches::default()),
                )),
        )
        .await;

    assert_eq!(response.errors.len(), 1);
    assert!(read_accounts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn updates_batch_upserts_and_removes_for_changed_sessions_only() {
    let harness = harness();
    let patches = ManualPatches::default();
    let service = FixedRegistrations {
        changes: WorkRegistrationChanges {
            active: vec![registration()],
            removed: vec![WorkRegistrationId::new_from_uuid(ENDED_ID)],
            refetch: false,
        },
        ..FixedRegistrations::default()
    };
    let changed_sessions = Arc::clone(&service.changed_sessions);
    let responses = harness.schema.execute_stream(subscription(
        service,
        &patches,
        vec![soup_agent_session(SESSION_ID)],
    ));
    pin_mut!(responses);
    let first = responses.next();
    pin_mut!(first);
    assert!(futures_poll_pending(first.as_mut()).await);

    // A change to anything but a session is not this stream's business.
    patches
        .send(Patch::Updated(
            ModelEntityType::Document.with_entity_string(Uuid::from_u128(1).to_string()),
        ))
        .await;
    patches.send(session_patch()).await;
    patches.send(session_patch()).await;

    let response = first.await.unwrap();
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["registeredWorkUpdates"],
        serde_json::json!([
            { "__typename": "GraphqlRegisteredWorkRemove", "id": ENDED_ID.to_string() },
            {
                "__typename": "GraphqlRegisteredWorkUpsert",
                "entry": {
                    "id": REGISTRATION_ID.to_string(),
                    "accountId": ACCOUNT,
                    "session": { "id": SESSION_ID.to_string(), "name": "A session" },
                },
            },
        ])
    );
    assert_eq!(*changed_sessions.lock().unwrap(), vec![vec![session()]]);
}

#[tokio::test]
async fn updates_ask_for_a_refetch_rather_than_name_what_the_viewer_cannot_view() {
    let harness = harness();
    let patches = ManualPatches::default();
    let service = FixedRegistrations {
        changes: WorkRegistrationChanges {
            refetch: true,
            ..WorkRegistrationChanges::default()
        },
        ..FixedRegistrations::default()
    };
    let responses = harness
        .schema
        .execute_stream(subscription(service, &patches, Vec::new()));
    pin_mut!(responses);
    let first = responses.next();
    pin_mut!(first);
    assert!(futures_poll_pending(first.as_mut()).await);

    patches.send(session_patch()).await;

    let response = first.await.unwrap();
    assert_eq!(
        response.data.into_json().unwrap()["registeredWorkUpdates"],
        serde_json::json!([{ "__typename": "GraphqlRegisteredWorkInvalidate", "refresh": true }])
    );
}

#[tokio::test]
async fn updates_ask_for_a_refetch_when_soup_hides_a_session_the_domain_allowed() {
    let harness = harness();
    let patches = ManualPatches::default();
    let service = FixedRegistrations {
        changes: WorkRegistrationChanges {
            active: vec![registration()],
            ..WorkRegistrationChanges::default()
        },
        ..FixedRegistrations::default()
    };
    let responses = harness
        .schema
        .execute_stream(subscription(service, &patches, Vec::new()));
    pin_mut!(responses);
    let first = responses.next();
    pin_mut!(first);
    assert!(futures_poll_pending(first.as_mut()).await);

    patches.send(session_patch()).await;

    let response = first.await.unwrap();
    assert_eq!(
        response.data.into_json().unwrap()["registeredWorkUpdates"],
        serde_json::json!([{ "__typename": "GraphqlRegisteredWorkInvalidate", "refresh": true }])
    );
}

#[tokio::test]
async fn updates_invalidate_then_end_when_the_source_ends() {
    let harness = harness();
    let patches = ManualPatches::default();
    let responses = harness.schema.execute_stream(subscription(
        FixedRegistrations::default(),
        &patches,
        Vec::new(),
    ));
    pin_mut!(responses);
    let first = responses.next();
    pin_mut!(first);
    assert!(futures_poll_pending(first.as_mut()).await);

    patches.close();

    let response = first.await.unwrap();
    assert_eq!(
        response.data.into_json().unwrap()["registeredWorkUpdates"],
        serde_json::json!([{ "__typename": "GraphqlRegisteredWorkInvalidate", "refresh": true }])
    );
    let ended = responses.next().await.unwrap();
    assert!(!ended.errors.is_empty());
}

#[tokio::test(start_paused = true)]
async fn updates_refetch_on_a_schedule_to_catch_revoked_access() {
    let harness = harness();
    let patches = ManualPatches::default();
    let responses = harness.schema.execute_stream(subscription(
        FixedRegistrations::default(),
        &patches,
        Vec::new(),
    ));
    pin_mut!(responses);

    let response = responses.next().await.unwrap();

    assert_eq!(
        response.data.into_json().unwrap()["registeredWorkUpdates"],
        serde_json::json!([{ "__typename": "GraphqlRegisteredWorkInvalidate", "refresh": true }])
    );
}

/// Poll once, so the stream has subscribed before the test sends anything. Whether it is still
/// waiting, which it always is before anything was sent.
async fn futures_poll_pending<F: Future + Unpin>(future: F) -> bool {
    async_graphql::futures_util::poll!(future).is_pending()
}
