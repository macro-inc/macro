use super::*;
use crate::domain::models::WebhookFilter;
use chrono::Utc;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use futures::StreamExt as _;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const SUBSCRIBER_ID: &str = "macro|reader@example.com";
const DOCUMENT_ID: &str = "11111111-1111-1111-1111-111111111111";
const OTHER_DOCUMENT_ID: &str = "22222222-2222-2222-2222-222222222222";
const TEAM_WORKSPACE_ID: &str = "33333333-3333-3333-3333-333333333333";
const FOREIGN_WORKSPACE_ID: &str = "44444444-4444-4444-4444-444444444444";

fn subscriber() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(SUBSCRIBER_ID.to_string()).expect("valid user id")
}

fn normalized(event_name: &str, entity_id: &str) -> NormalizedWebhookEvent {
    NormalizedWebhookEvent {
        event_id: Uuid::now_v7().to_string(),
        schema_version: 1,
        event_name: event_name.to_string(),
        entity_type: "document".to_string(),
        entity_id: entity_id.to_string(),
        ordering_key: entity_id.to_string(),
        occurred_at: Utc::now(),
        broker_envelope: serde_json::json!({ "event_type": event_name }),
    }
}

fn document_candidate(event_name: &str, document_id: &str) -> StreamCandidateEvent {
    StreamCandidateEvent {
        event: normalized(event_name, document_id),
        audience: StreamAudience::Entity {
            entity_id: document_id.to_string(),
            entity_type: EntityType::Document,
        },
    }
}

fn workspace_candidate(event_name: &str, workspace_id: &str) -> StreamCandidateEvent {
    let mut candidate = document_candidate(event_name, "wh_test");
    candidate.audience = StreamAudience::Workspace {
        workspace_id: workspace_id.to_string(),
    };
    candidate
}

#[tokio::test]
async fn private_call_event_streams_only_to_the_recipient() {
    let (service, feed) = service(FakeAccessService::allowing(&[]));
    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["call.invited"]),
                None,
            )
            .await
            .unwrap(),
    );
    feed.publish(StreamCandidateEvent {
        event: normalized("call.invited", DOCUMENT_ID),
        audience: StreamAudience::User {
            user_id: "macro|other@example.com".to_string(),
        },
    });
    feed.publish(StreamCandidateEvent {
        event: normalized("call.invited", DOCUMENT_ID),
        audience: StreamAudience::User {
            user_id: SUBSCRIBER_ID.to_string(),
        },
    });

    let delivered: Vec<_> = stream.take(1).collect().await;
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].event_name, "call.invited");
}

fn filter(events: &[&str]) -> WebhookFilters {
    vec![WebhookFilter {
        events: events.iter().map(|event| event.to_string()).collect(),
        ids: None,
    }]
}

/// Access service granting explicit accessor membership to a fixed entity id set.
#[derive(Clone)]
struct FakeAccessService {
    accessor_entity_ids: Vec<String>,
    /// Entity ids `get_access_level` would treat as View (e.g. PUBLIC link-share).
    link_share_entity_ids: Vec<String>,
    users_by_entity_calls: Arc<Mutex<usize>>,
    access_level_calls: Arc<Mutex<usize>>,
}

impl FakeAccessService {
    fn allowing(entity_ids: &[&str]) -> Self {
        Self {
            accessor_entity_ids: entity_ids.iter().map(|id| id.to_string()).collect(),
            link_share_entity_ids: Vec::new(),
            users_by_entity_calls: Arc::default(),
            access_level_calls: Arc::default(),
        }
    }

    fn link_share_only(entity_ids: &[&str]) -> Self {
        Self {
            accessor_entity_ids: Vec::new(),
            link_share_entity_ids: entity_ids.iter().map(|id| id.to_string()).collect(),
            users_by_entity_calls: Arc::default(),
            access_level_calls: Arc::default(),
        }
    }
}

impl EntityAccessService for FakeAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        *self.access_level_calls.lock().unwrap() += 1;
        Ok(self
            .accessor_entity_ids
            .iter()
            .chain(self.link_share_entity_ids.iter())
            .any(|allowed| allowed == entity_id)
            .then_some(AccessLevel::View))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        *self.users_by_entity_calls.lock().unwrap() += 1;
        if entity_type == EntityType::AgentSession {
            return Err(AccessError::BadRequest(
                "get_users_by_entity does not support this entity type",
            ));
        }
        if self
            .accessor_entity_ids
            .iter()
            .any(|allowed| allowed == entity_id)
        {
            Ok(vec![subscriber()])
        } else {
            Ok(vec![])
        }
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!("not used by webhook event streaming")
    }
}

#[derive(Clone)]
struct FakeWorkspaceResolver {
    /// Highest-role team, matching `get_user_team_workspace_id`.
    team_workspace_id: Arc<Mutex<Option<String>>>,
}

impl FakeWorkspaceResolver {
    fn with_team(team_workspace_id: Option<String>) -> Self {
        Self {
            team_workspace_id: Arc::new(Mutex::new(team_workspace_id)),
        }
    }
}

impl WebhookWorkspaceResolver for FakeWorkspaceResolver {
    type Err = anyhow::Error;

    async fn resolve_workspace_ids(
        &self,
        people: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<String>, Self::Err> {
        let mut ids: Vec<String> = people
            .iter()
            .map(|person| person.as_ref().to_string())
            .collect();
        if let Some(team) = self.team_workspace_id.lock().unwrap().clone() {
            ids.push(team);
        }
        Ok(ids)
    }

    async fn get_user_team_workspace_id(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        Ok(self.team_workspace_id.lock().unwrap().clone())
    }
}

/// Contact pairs the fake graph knows, as `(user, other)`; counts lookups.
#[derive(Clone, Default)]
struct FakeContactChecker {
    pairs: Arc<Mutex<Vec<(String, String)>>>,
    calls: Arc<Mutex<usize>>,
}

impl FakeContactChecker {
    fn with_pair(user: &str, other: &str) -> Self {
        let checker = Self::default();
        checker
            .pairs
            .lock()
            .unwrap()
            .push((user.to_string(), other.to_string()));
        checker
    }
}

impl WebhookContactChecker for FakeContactChecker {
    type Err = anyhow::Error;

    async fn is_contact(
        &self,
        user: MacroUserIdStr<'static>,
        other: MacroUserIdStr<'static>,
    ) -> Result<bool, Self::Err> {
        *self.calls.lock().unwrap() += 1;
        Ok(self
            .pairs
            .lock()
            .unwrap()
            .iter()
            .any(|(a, b)| a == user.as_ref() && b == other.as_ref()))
    }
}

type TestService =
    WebhookEventStreamServiceImpl<FakeAccessService, FakeWorkspaceResolver, FakeContactChecker>;

fn service(access: FakeAccessService) -> (TestService, StreamFeed) {
    service_with_team(access, Some(TEAM_WORKSPACE_ID.to_string()))
}

fn service_with_team(
    access: FakeAccessService,
    team_workspace_id: Option<String>,
) -> (TestService, StreamFeed) {
    let feed = StreamFeed::new(16, WEBHOOK_STREAM_REPLAY_CAPACITY);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(access),
        FakeWorkspaceResolver::with_team(team_workspace_id),
        FakeContactChecker::default(),
    );
    (service, feed)
}

#[test]
fn filter_accepts_its_events_and_optional_entity_ids() {
    let document_filter = WebhookFilter {
        events: vec!["document.updated".to_string()],
        ids: Some(vec![DOCUMENT_ID.to_string()]),
    };
    let message_filter = WebhookFilter {
        events: vec!["message.posted".to_string()],
        ids: None,
    };

    assert!(document_filter.accepts("document.updated", DOCUMENT_ID));
    assert!(!document_filter.accepts("document.updated", OTHER_DOCUMENT_ID));
    assert!(!document_filter.accepts("document.created", DOCUMENT_ID));
    assert!(message_filter.accepts("message.posted", "any-channel-id"));
}

#[tokio::test]
async fn open_stream_delivers_only_matching_accessible_events() {
    let candidates = vec![
        document_candidate("document.updated", DOCUMENT_ID),
        // Filter matches but the subscriber has no access: skipped.
        document_candidate("document.updated", OTHER_DOCUMENT_ID),
        // Access would pass but the filter does not match: skipped.
        document_candidate("document.created", DOCUMENT_ID),
        workspace_candidate("document.updated", SUBSCRIBER_ID),
        workspace_candidate("document.updated", TEAM_WORKSPACE_ID),
        workspace_candidate("document.updated", FOREIGN_WORKSPACE_ID),
    ];
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));

    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    for candidate in candidates {
        feed.publish(candidate);
    }
    let delivered: Vec<NormalizedWebhookEvent> = stream.take(2).collect().await;

    let delivered_entities: Vec<&str> = delivered
        .iter()
        .map(|event| event.entity_id.as_str())
        .collect();
    assert_eq!(delivered_entities, vec![DOCUMENT_ID, "wh_test"]);
}

#[tokio::test]
async fn team_scope_requires_team_membership() {
    let (service, _) = service_with_team(FakeAccessService::allowing(&[]), None);

    let Err(error) = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["webhook.updated"]),
            None,
        )
        .await
    else {
        panic!("team scope without team membership must be rejected");
    };

    assert!(matches!(error, WebhookStreamError::BadRequest(_)));
}

#[tokio::test]
async fn open_stream_checks_access_for_each_matching_event() {
    let candidates = vec![
        document_candidate("document.updated", DOCUMENT_ID),
        document_candidate("document.updated", DOCUMENT_ID),
        document_candidate("document.updated", DOCUMENT_ID),
    ];
    let access = FakeAccessService::allowing(&[DOCUMENT_ID]);
    let call_count = access.users_by_entity_calls.clone();
    let (service, feed) = service(access);

    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    for candidate in candidates {
        feed.publish(candidate);
    }
    let delivered: Vec<NormalizedWebhookEvent> = stream.take(3).collect().await;

    assert_eq!(delivered.len(), 3);
    assert_eq!(*call_count.lock().unwrap(), 3);
}

#[tokio::test]
async fn open_stream_rejects_empty_or_degenerate_filters() {
    let (service, _) = service(FakeAccessService::allowing(&[]));

    for filters in [
        vec![],
        vec![WebhookFilter {
            events: vec![],
            ids: None,
        }],
        vec![WebhookFilter {
            events: vec![String::new()],
            ids: None,
        }],
        vec![WebhookFilter {
            events: vec!["document.updated".to_string()],
            ids: Some(vec![]),
        }],
    ] {
        let Err(error) = service
            .open_stream(subscriber(), WebhookScope::Team, filters, None)
            .await
        else {
            panic!("degenerate filters must be rejected");
        };
        assert!(matches!(error, WebhookStreamError::BadRequest(_)));
    }
}

#[tokio::test]
async fn a_lagging_live_only_stream_skips_missed_events_and_continues() {
    let feed = StreamFeed::new(2, WEBHOOK_STREAM_REPLAY_CAPACITY);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(FakeAccessService::allowing(&[DOCUMENT_ID])),
        FakeWorkspaceResolver::with_team(Some(TEAM_WORKSPACE_ID.to_string())),
        FakeContactChecker::default(),
    );
    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                None,
            )
            .await
            .expect("stream opens"),
    );

    feed.publish(document_candidate("document.updated", DOCUMENT_ID));
    feed.publish(document_candidate("document.updated", DOCUMENT_ID));
    let latest = document_candidate("document.updated", DOCUMENT_ID);
    let latest_id = latest.event.event_id.clone();
    feed.publish(latest);

    let delivered = next_within(&mut stream).await;
    assert_ne!(delivered.event_id, latest_id);
    assert_eq!(next_within(&mut stream).await.event_id, latest_id);
}

#[tokio::test]
async fn a_lagging_resumed_stream_ends_so_the_subscriber_resumes_and_replays() {
    let feed = StreamFeed::new(2, WEBHOOK_STREAM_REPLAY_CAPACITY);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(FakeAccessService::allowing(&[DOCUMENT_ID])),
        FakeWorkspaceResolver::with_team(Some(TEAM_WORKSPACE_ID.to_string())),
        FakeContactChecker::default(),
    );
    let since = cursor_at(Utc::now() - chrono::Duration::seconds(1));
    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                Some(since),
            )
            .await
            .expect("stream opens"),
    );

    let candidates: Vec<StreamCandidateEvent> = (0..3)
        .map(|_| document_candidate("document.updated", DOCUMENT_ID))
        .collect();
    let published: Vec<String> = candidates
        .iter()
        .map(|candidate| candidate.event.event_id.clone())
        .collect();
    for candidate in candidates {
        feed.publish(candidate);
    }

    assert!(
        stream.next().await.is_none(),
        "a subscriber that missed events must not silently continue"
    );
    let mut resumed = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                Some(since),
            )
            .await
            .expect("stream reopens"),
    );
    for id in published {
        assert_eq!(next_within(&mut resumed).await.event_id, id);
    }
}

#[tokio::test]
async fn a_heartbeat_reaches_every_subscriber_whatever_its_filters() {
    let (service, feed) = service(FakeAccessService::allowing(&[]));
    let mut documents = service
        .open_stream(
            subscriber(),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .expect("stream opens");
    let mut calls = service
        .open_stream(
            subscriber(),
            WebhookScope::User,
            filter(&["call.invited"]),
            None,
        )
        .await
        .expect("stream opens");

    // Inaccessible, so nothing but the heartbeat reaches either stream.
    feed.publish(document_candidate("document.updated", DOCUMENT_ID));
    feed.heartbeat();

    for stream in [&mut documents, &mut calls] {
        let item = tokio::time::timeout(std::time::Duration::from_secs(1), stream.next())
            .await
            .expect("heartbeat in time")
            .expect("stream open");
        assert!(matches!(item, StreamItem::Heartbeat), "{item:?}");
    }
}

#[tokio::test]
async fn a_heartbeat_arrives_after_the_events_queued_before_it() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let mut stream = service
        .open_stream(
            subscriber(),
            WebhookScope::User,
            filter(&["document.updated"]),
            None,
        )
        .await
        .expect("stream opens");
    let candidate = document_candidate("document.updated", DOCUMENT_ID);
    let id = candidate.event.event_id.clone();

    feed.publish(candidate);
    feed.heartbeat();

    match stream.next().await {
        Some(StreamItem::Event(event)) => assert_eq!(event.event_id, id),
        other => panic!("expected the event first, got {other:?}"),
    }
    assert!(matches!(stream.next().await, Some(StreamItem::Heartbeat)));
}

#[tokio::test]
async fn a_heartbeat_is_never_replayed_to_a_resuming_subscriber() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let since = cursor_at(Utc::now() - chrono::Duration::seconds(1));
    feed.heartbeat();
    let candidate = document_candidate("document.updated", DOCUMENT_ID);
    let id = candidate.event.event_id.clone();
    feed.publish(candidate);

    let mut stream = service
        .open_stream(
            subscriber(),
            WebhookScope::User,
            filter(&["document.updated"]),
            Some(since),
        )
        .await
        .expect("stream opens");

    match stream.next().await {
        Some(StreamItem::Event(event)) => assert_eq!(event.event_id, id),
        other => panic!("expected the retained event, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), stream.next())
            .await
            .is_err(),
        "nothing else was retained"
    );
}

/// Only the events of a stream, without its heartbeats.
fn events(stream: BoxStream<'static, StreamItem>) -> BoxStream<'static, NormalizedWebhookEvent> {
    stream
        .filter_map(|item| {
            futures::future::ready(match item {
                StreamItem::Event(event) => Some(event),
                StreamItem::Heartbeat => None,
            })
        })
        .boxed()
}

#[tokio::test]
async fn open_stream_does_not_deliver_link_share_only_entities() {
    let (service, feed) = service(FakeAccessService::link_share_only(&[DOCUMENT_ID]));

    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    feed.publish(document_candidate("document.updated", DOCUMENT_ID));
    feed.publish(workspace_candidate("document.updated", SUBSCRIBER_ID));

    let delivered: Vec<NormalizedWebhookEvent> = stream.take(1).collect().await;
    assert_eq!(
        delivered
            .iter()
            .map(|event| event.entity_id.as_str())
            .collect::<Vec<_>>(),
        vec!["wh_test"]
    );
}

#[tokio::test]
async fn team_scope_uses_highest_role_team_not_first_resolved_workspace() {
    // Highest-role team is FOREIGN; TEAM would sort first by team_id text.
    let (service, feed) = service_with_team(
        FakeAccessService::allowing(&[]),
        Some(FOREIGN_WORKSPACE_ID.to_string()),
    );

    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["webhook.created"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    feed.publish(workspace_candidate("webhook.created", TEAM_WORKSPACE_ID));
    feed.publish(workspace_candidate("webhook.created", FOREIGN_WORKSPACE_ID));

    let delivered: Vec<NormalizedWebhookEvent> = stream.take(1).collect().await;
    assert_eq!(delivered.len(), 1);
}

#[tokio::test]
async fn team_membership_revocation_ends_the_stream() {
    let resolver = FakeWorkspaceResolver::with_team(Some(TEAM_WORKSPACE_ID.to_string()));
    let feed = StreamFeed::new(16, WEBHOOK_STREAM_REPLAY_CAPACITY);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(FakeAccessService::allowing(&[])),
        resolver.clone(),
        FakeContactChecker::default(),
    );
    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["webhook.created"]),
                None,
            )
            .await
            .expect("stream opens"),
    );

    *resolver.team_workspace_id.lock().unwrap() = None;
    feed.publish(workspace_candidate("webhook.created", TEAM_WORKSPACE_ID));

    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn agent_session_events_fall_back_to_access_level() {
    const SESSION_ID: &str = "55555555-5555-5555-5555-555555555555";
    let access = FakeAccessService::allowing(&[SESSION_ID]);
    let access_level_calls = access.access_level_calls.clone();
    let (service, feed) = service(access);

    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["agent_trigger.existing"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    feed.publish(StreamCandidateEvent {
        event: normalized("agent_trigger.existing", SESSION_ID),
        audience: StreamAudience::Entity {
            entity_id: SESSION_ID.to_string(),
            entity_type: EntityType::AgentSession,
        },
    });

    let delivered: Vec<NormalizedWebhookEvent> = stream.take(1).collect().await;
    assert_eq!(delivered[0].entity_id, SESSION_ID);
    assert_eq!(*access_level_calls.lock().unwrap(), 1);
}

#[tokio::test]
async fn wildcard_stream_delivers_future_event_types_only_with_current_access() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let stream = events(
        service
            .open_stream(subscriber(), WebhookScope::Team, filter(&["*"]), None)
            .await
            .expect("wildcard stream opens"),
    );
    feed.publish(document_candidate("future.event", OTHER_DOCUMENT_ID));
    feed.publish(workspace_candidate("future.event", FOREIGN_WORKSPACE_ID));
    feed.publish(document_candidate("future.event", DOCUMENT_ID));
    feed.publish(workspace_candidate("another.event", TEAM_WORKSPACE_ID));
    let delivered: Vec<NormalizedWebhookEvent> = stream.take(2).collect().await;
    assert_eq!(delivered[0].entity_id, DOCUMENT_ID);
    assert_eq!(delivered[0].event_name, "future.event");
    assert_eq!(delivered[1].event_name, "another.event");
}

#[tokio::test]
async fn wildcard_stream_preserves_entity_id_filters() {
    let (service, feed) = service(FakeAccessService::allowing(&[
        DOCUMENT_ID,
        OTHER_DOCUMENT_ID,
    ]));
    let stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                vec![WebhookFilter {
                    events: vec!["*".to_string()],
                    ids: Some(vec![DOCUMENT_ID.to_string()]),
                }],
                None,
            )
            .await
            .expect("wildcard stream opens"),
    );
    feed.publish(document_candidate("document.updated", OTHER_DOCUMENT_ID));
    feed.publish(document_candidate("future.event", DOCUMENT_ID));
    let delivered: Vec<NormalizedWebhookEvent> = stream.take(1).collect().await;
    assert_eq!(delivered[0].entity_id, DOCUMENT_ID);
}

const CHANGED_USER_ID: &str = "macro|changed@example.com";

fn picture_candidate(team_workspace_ids: &[&str]) -> StreamCandidateEvent {
    let mut audiences = vec![StreamAudience::ContactsOf {
        user_id: CHANGED_USER_ID.to_string(),
    }];
    audiences.extend(
        team_workspace_ids
            .iter()
            .map(|id| StreamAudience::Workspace {
                workspace_id: (*id).to_string(),
            }),
    );
    let mut candidate = document_candidate("user.picture_changed", CHANGED_USER_ID);
    candidate.audience = StreamAudience::Any(audiences);
    candidate
}

/// Whether one picture event reaches a stream with this scope.
async fn picture_reaches(
    scope: WebhookScope,
    subscriber: MacroUserIdStr<'static>,
    contacts: FakeContactChecker,
    candidate: StreamCandidateEvent,
) -> bool {
    let feed = StreamFeed::new(16, WEBHOOK_STREAM_REPLAY_CAPACITY);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(FakeAccessService::allowing(&[])),
        FakeWorkspaceResolver::with_team(Some(TEAM_WORKSPACE_ID.to_string())),
        contacts,
    );
    let mut stream = events(
        service
            .open_stream(subscriber, scope, filter(&["user.picture_changed"]), None)
            .await
            .expect("stream opens"),
    );
    feed.publish(candidate);
    // Sentinel the stream always delivers, so a skipped event ends the wait.
    let sentinel_workspace = match scope {
        WebhookScope::User => SUBSCRIBER_ID,
        WebhookScope::Team => TEAM_WORKSPACE_ID,
    };
    feed.publish(workspace_candidate(
        "user.picture_changed",
        sentinel_workspace,
    ));
    let first = stream.next().await.expect("sentinel arrives");
    first.entity_id == CHANGED_USER_ID
}

#[tokio::test]
async fn picture_event_reaches_the_changed_user() {
    let changed = MacroUserIdStr::try_from(CHANGED_USER_ID.to_string()).unwrap();
    let contacts = FakeContactChecker::default();
    assert!(
        picture_reaches(
            WebhookScope::User,
            changed,
            contacts.clone(),
            picture_candidate(&[])
        )
        .await
    );
    assert_eq!(*contacts.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn picture_event_reaches_a_contact_with_one_lookup() {
    let contacts = FakeContactChecker::with_pair(SUBSCRIBER_ID, CHANGED_USER_ID);
    assert!(
        picture_reaches(
            WebhookScope::User,
            subscriber(),
            contacts.clone(),
            picture_candidate(&[])
        )
        .await
    );
    assert_eq!(*contacts.calls.lock().unwrap(), 1);
}

#[tokio::test]
async fn picture_event_skips_a_subscriber_only_the_changed_user_has() {
    // Directories are directed: the changed user having the subscriber does
    // not put the changed user in the subscriber's directory.
    let contacts = FakeContactChecker::with_pair(CHANGED_USER_ID, SUBSCRIBER_ID);
    assert!(
        !picture_reaches(
            WebhookScope::User,
            subscriber(),
            contacts,
            picture_candidate(&[])
        )
        .await
    );
}

#[tokio::test]
async fn picture_event_skips_a_non_contact() {
    let contacts = FakeContactChecker::default();
    assert!(
        !picture_reaches(
            WebhookScope::User,
            subscriber(),
            contacts,
            picture_candidate(&[FOREIGN_WORKSPACE_ID])
        )
        .await
    );
}

#[tokio::test]
async fn picture_event_reaches_team_streams_of_the_users_teams_only() {
    assert!(
        picture_reaches(
            WebhookScope::Team,
            subscriber(),
            FakeContactChecker::default(),
            picture_candidate(&[FOREIGN_WORKSPACE_ID, TEAM_WORKSPACE_ID])
        )
        .await
    );
    assert!(
        !picture_reaches(
            WebhookScope::Team,
            subscriber(),
            FakeContactChecker::default(),
            picture_candidate(&[FOREIGN_WORKSPACE_ID])
        )
        .await
    );
}

#[tokio::test]
async fn team_stream_does_not_get_contact_audience() {
    // A contact's team-scoped stream is not the contact's own user stream.
    let contacts = FakeContactChecker::with_pair(SUBSCRIBER_ID, CHANGED_USER_ID);
    assert!(
        !picture_reaches(
            WebhookScope::Team,
            subscriber(),
            contacts.clone(),
            picture_candidate(&[])
        )
        .await
    );
    assert_eq!(*contacts.calls.lock().unwrap(), 0);
}

const TEAMMATE_ID: &str = "macro|teammate@example.com";

/// A composer request to a bot's own runtime, asked by `requester`.
fn requested_session_candidate(requester: &str) -> StreamCandidateEvent {
    requested_session_candidate_for(requester, None)
}

/// A composer request asked by `requester` to a runtime that authenticates
/// as `runtime_user`.
fn requested_session_candidate_for(
    requester: &str,
    runtime_user: Option<&str>,
) -> StreamCandidateEvent {
    use agent_trigger::domain::broker_events::{
        AgentSessionRequestedEvent, AgentTriggerTopicEvent, NewAgentSessionEvent,
    };
    let event = macro_event_broker::Event::new(AgentTriggerTopicEvent::New(
        NewAgentSessionEvent::Requested(AgentSessionRequestedEvent {
            origin: trigger_context::TriggerOrigin::Unknown,
            repo_url: None,
            bot_id: bot_id::BotId::new_from_uuid(Uuid::from_u128(0xB07)),
            session_id: agent_session::domain::model::AgentSessionId::new_from_uuid(
                Uuid::from_u128(0x5E55),
            ),
            owner: requester.to_owned(),
            context: None,
            runtime_user: runtime_user.map(str::to_owned),
        }),
    ));
    crate::domain::ingestion::stream::agent_trigger_stream_candidate(&event)
        .expect("requested sessions stream")
}

/// The first event a stream delivers when a requested session for
/// `requester` is followed by a team event every team stream receives.
async fn first_after_requested(
    subscriber_id: &str,
    scope: WebhookScope,
    requester: &str,
) -> NormalizedWebhookEvent {
    first_after(subscriber_id, scope, requested_session_candidate(requester)).await
}

async fn first_after(
    subscriber_id: &str,
    scope: WebhookScope,
    requested: StreamCandidateEvent,
) -> NormalizedWebhookEvent {
    let (service, feed) = service(FakeAccessService::allowing(&[]));
    let mut stream = events(
        service
            .open_stream(
                MacroUserIdStr::try_from(subscriber_id.to_owned()).expect("valid user id"),
                scope,
                filter(&[requested.event.event_name.as_str(), "webhook.created"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    feed.publish(requested);
    feed.publish(workspace_candidate("webhook.created", TEAM_WORKSPACE_ID));
    tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
        .await
        .expect("an event is delivered in time")
        .expect("the stream stays open")
}

/// A harness shared with a team streams team-scoped, so a requester's own
/// composer request must still reach it there.
#[tokio::test]
async fn a_requested_session_reaches_the_requesters_team_stream() {
    let first = first_after_requested(SUBSCRIBER_ID, WebhookScope::Team, SUBSCRIBER_ID).await;
    assert_ne!(
        first.event_name, "webhook.created",
        "the request was dropped"
    );
}

#[tokio::test]
async fn a_requested_session_does_not_reach_a_teammates_team_stream() {
    let first = first_after_requested(TEAMMATE_ID, WebhookScope::Team, SUBSCRIBER_ID).await;
    assert_eq!(first.event_name, "webhook.created");
}

#[tokio::test]
async fn a_requested_session_reaches_the_requesters_user_stream() {
    let first = first_after_requested(SUBSCRIBER_ID, WebhookScope::User, SUBSCRIBER_ID).await;
    assert_ne!(first.event_name, "webhook.created");
}

const BUYER_ID: &str = "macro|buyer@example.com";

/// A team computer's runtime streams as its buyer; a teammate's request to it
/// still reaches that stream.
#[tokio::test]
async fn a_teammates_request_reaches_the_runtime_owners_team_stream() {
    let requested = requested_session_candidate_for(TEAMMATE_ID, Some(BUYER_ID));
    let first = first_after(BUYER_ID, WebhookScope::Team, requested).await;
    assert_ne!(
        first.event_name, "webhook.created",
        "the request was dropped"
    );
}

#[tokio::test]
async fn a_teammates_request_does_not_reach_a_third_members_team_stream() {
    let requested = requested_session_candidate_for(TEAMMATE_ID, Some(BUYER_ID));
    let first = first_after(SUBSCRIBER_ID, WebhookScope::Team, requested).await;
    assert_eq!(first.event_name, "webhook.created");
}

/// The next event `stream` delivers, or a failure when none arrives.
async fn next_within(
    stream: &mut BoxStream<'static, NormalizedWebhookEvent>,
) -> NormalizedWebhookEvent {
    tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
        .await
        .expect("an event is delivered in time")
        .expect("the stream stays open")
}

fn cursor_of(candidate: &StreamCandidateEvent) -> StreamCursor {
    StreamCursor::parse(&candidate.event.event_id).expect("event ids are cursors")
}

/// A cursor minted from a time rather than an event: the first UUIDv7 of
/// that millisecond.
fn cursor_at(time: chrono::DateTime<Utc>) -> StreamCursor {
    let millis = u64::try_from(time.timestamp_millis()).expect("after the epoch");
    let id = uuid::Builder::from_unix_timestamp_millis(millis, &[0; 10]).into_uuid();
    StreamCursor::parse(&id.to_string()).expect("a UUIDv7 is a cursor")
}

/// The race the cursor closes: a session requested while the runtime's
/// stream was not yet open for its agent reaches the stream it opens next.
#[tokio::test]
async fn a_request_published_before_the_runtime_streams_reaches_it_when_it_resumes() {
    let (service, feed) = service(FakeAccessService::allowing(&[]));
    let last_seen = workspace_candidate("webhook.created", SUBSCRIBER_ID);
    let cursor = cursor_of(&last_seen);
    feed.publish(last_seen);
    let requested = requested_session_candidate(SUBSCRIBER_ID);
    let requested_id = requested.event.event_id.clone();
    let requested_name = requested.event.event_name.clone();
    feed.publish(requested);

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&[requested_name.as_str(), "webhook.created"]),
                Some(cursor),
            )
            .await
            .expect("stream opens"),
    );

    assert_eq!(next_within(&mut stream).await.event_id, requested_id);
}

#[tokio::test]
async fn a_resumed_stream_replays_around_its_cursor_but_never_the_cursor_itself() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let before = document_candidate("document.updated", DOCUMENT_ID);
    let before_id = before.event.event_id.clone();
    let seen = document_candidate("document.updated", DOCUMENT_ID);
    let cursor = cursor_of(&seen);
    let missed = document_candidate("document.updated", DOCUMENT_ID);
    let missed_id = missed.event.event_id.clone();
    feed.publish(before);
    feed.publish(seen);
    feed.publish(missed);

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                Some(cursor),
            )
            .await
            .expect("stream opens"),
    );
    let live = document_candidate("document.updated", DOCUMENT_ID);
    let live_id = live.event.event_id.clone();
    feed.publish(live);

    // Events minted just before the cursor come again (the client drops
    // what it already saw); the cursor's own event does not.
    assert_eq!(next_within(&mut stream).await.event_id, before_id);
    assert_eq!(next_within(&mut stream).await.event_id, missed_id);
    assert_eq!(next_within(&mut stream).await.event_id, live_id);
}

/// Replicas consume the topics in their own order, so the event after a
/// cursor on one replica can sit before it on the next. Resuming on that
/// replica must still deliver it.
#[tokio::test]
async fn a_cursor_from_another_replicas_order_still_replays_what_followed_it() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let seen = document_candidate("document.updated", DOCUMENT_ID);
    let cursor = cursor_of(&seen);
    let next = document_candidate("document.updated", DOCUMENT_ID);
    let next_id = next.event.event_id.clone();
    // This replica received `next` first.
    feed.publish(next);
    feed.publish(seen);

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                Some(cursor),
            )
            .await
            .expect("stream opens"),
    );

    assert_eq!(next_within(&mut stream).await.event_id, next_id);
}

#[tokio::test]
async fn replayed_events_pass_the_same_filters_and_access_checks() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let since = cursor_at(Utc::now() - chrono::Duration::seconds(1));
    feed.publish(document_candidate("document.updated", OTHER_DOCUMENT_ID));
    feed.publish(document_candidate("document.created", DOCUMENT_ID));
    let allowed = document_candidate("document.updated", DOCUMENT_ID);
    let allowed_id = allowed.event.event_id.clone();
    feed.publish(allowed);

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                Some(since),
            )
            .await
            .expect("stream opens"),
    );

    assert_eq!(next_within(&mut stream).await.event_id, allowed_id);
}

#[tokio::test]
async fn a_cursor_this_process_never_saw_resumes_at_the_time_it_encodes() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    let before = document_candidate("document.updated", DOCUMENT_ID);
    let before_id = before.event.event_id.clone();
    feed.publish(before);
    let future = cursor_at(Utc::now() + chrono::Duration::seconds(60));

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                Some(future),
            )
            .await
            .expect("stream opens"),
    );
    let live = document_candidate("document.updated", DOCUMENT_ID);
    let live_id = live.event.event_id.clone();
    feed.publish(live);

    let delivered = next_within(&mut stream).await.event_id;
    assert_ne!(
        delivered, before_id,
        "an event from before the cursor's time"
    );
    assert_eq!(delivered, live_id);
}

#[tokio::test]
async fn a_stream_without_a_cursor_starts_live() {
    let (service, feed) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));
    feed.publish(document_candidate("document.updated", DOCUMENT_ID));

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                None,
            )
            .await
            .expect("stream opens"),
    );
    let live = document_candidate("document.updated", DOCUMENT_ID);
    let live_id = live.event.event_id.clone();
    feed.publish(live);

    assert_eq!(next_within(&mut stream).await.event_id, live_id);
}

#[tokio::test]
async fn the_feed_keeps_only_its_newest_events_for_replay() {
    let feed = StreamFeed::new(16, 2);
    let service = WebhookEventStreamServiceImpl::new(
        feed.clone(),
        Arc::new(FakeAccessService::allowing(&[DOCUMENT_ID])),
        FakeWorkspaceResolver::with_team(None),
        FakeContactChecker::default(),
    );
    let since = cursor_at(Utc::now() - chrono::Duration::seconds(1));
    let candidates: Vec<StreamCandidateEvent> = (0..3)
        .map(|_| document_candidate("document.updated", DOCUMENT_ID))
        .collect();
    let kept: Vec<String> = candidates[1..]
        .iter()
        .map(|candidate| candidate.event.event_id.clone())
        .collect();
    for candidate in candidates {
        feed.publish(candidate);
    }

    let mut stream = events(
        service
            .open_stream(
                subscriber(),
                WebhookScope::User,
                filter(&["document.updated"]),
                Some(since),
            )
            .await
            .expect("stream opens"),
    );

    assert_eq!(next_within(&mut stream).await.event_id, kept[0]);
    assert_eq!(next_within(&mut stream).await.event_id, kept[1]);
}

#[test]
fn a_cursor_must_be_a_uuidv7_event_id() {
    assert!(StreamCursor::parse("not-an-id").is_err());
    assert!(StreamCursor::parse(&Uuid::new_v4().to_string()).is_err());
    assert!(StreamCursor::parse(&Uuid::now_v7().to_string()).is_ok());
}
