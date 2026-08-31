use super::*;
use crate::domain::models::WebhookFilter;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use futures::StreamExt as _;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use uuid::{NoContext, Timestamp};

const SUBSCRIBER_ID: &str = "macro|reader@example.com";
const DOCUMENT_ID: &str = "11111111-1111-1111-1111-111111111111";
const OTHER_DOCUMENT_ID: &str = "22222222-2222-2222-2222-222222222222";
const TEAM_WORKSPACE_ID: &str = "33333333-3333-3333-3333-333333333333";
const FOREIGN_WORKSPACE_ID: &str = "44444444-4444-4444-4444-444444444444";

fn subscriber() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(SUBSCRIBER_ID.to_string()).expect("valid user id")
}

fn uuid_v7_at_ms(unix_ms: i64) -> Uuid {
    let seconds = u64::try_from(unix_ms / 1000).expect("non-negative test timestamp");
    let nanoseconds = u32::try_from(unix_ms % 1000).expect("in range") * 1_000_000;
    Uuid::new_v7(Timestamp::from_unix(NoContext, seconds, nanoseconds))
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

fn filter(events: &[&str]) -> WebhookFilters {
    vec![WebhookFilter {
        events: events.iter().map(|event| event.to_string()).collect(),
        ids: None,
    }]
}

/// Source that yields queued candidates, then fails (ending the stream).
struct FakeSource {
    candidates: VecDeque<StreamCandidateEvent>,
}

impl WebhookStreamSource for FakeSource {
    async fn next_event(&mut self) -> Result<StreamCandidateEvent, rootcause::Report> {
        self.candidates
            .pop_front()
            .ok_or_else(|| rootcause::report!("fake source exhausted"))
    }
}

#[derive(Clone, Default)]
struct FakeSourceFactory {
    candidates: Arc<Mutex<VecDeque<StreamCandidateEvent>>>,
    opened_starts: Arc<Mutex<Vec<StreamStart>>>,
}

impl FakeSourceFactory {
    fn with_candidates(candidates: Vec<StreamCandidateEvent>) -> Self {
        Self {
            candidates: Arc::new(Mutex::new(candidates.into())),
            opened_starts: Arc::default(),
        }
    }
}

impl WebhookStreamSourceFactory for FakeSourceFactory {
    type Source = FakeSource;

    async fn open(&self, start: StreamStart) -> Result<Self::Source, WebhookStreamSourceOpenError> {
        self.opened_starts.lock().unwrap().push(start);
        Ok(FakeSource {
            candidates: std::mem::take(&mut *self.candidates.lock().unwrap()),
        })
    }
}

/// Access service granting view access to a fixed entity id set.
#[derive(Clone)]
struct FakeAccessService {
    allowed_entity_ids: Vec<String>,
    call_count: Arc<Mutex<usize>>,
}

impl FakeAccessService {
    fn allowing(entity_ids: &[&str]) -> Self {
        Self {
            allowed_entity_ids: entity_ids.iter().map(|id| id.to_string()).collect(),
            call_count: Arc::default(),
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
        *self.call_count.lock().unwrap() += 1;
        Ok(self
            .allowed_entity_ids
            .iter()
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
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!("not used by webhook event streaming")
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
    workspace_ids: Vec<String>,
}

impl WebhookWorkspaceResolver for FakeWorkspaceResolver {
    type Err = anyhow::Error;

    async fn resolve_workspace_ids(
        &self,
        _people: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<String>, Self::Err> {
        Ok(self.workspace_ids.clone())
    }
}

fn service(
    factory: FakeSourceFactory,
    access: FakeAccessService,
) -> WebhookEventStreamServiceImpl<FakeSourceFactory, FakeAccessService, FakeWorkspaceResolver> {
    service_with_workspaces(
        factory,
        access,
        vec![SUBSCRIBER_ID.to_string(), TEAM_WORKSPACE_ID.to_string()],
    )
}

fn service_with_workspaces(
    factory: FakeSourceFactory,
    access: FakeAccessService,
    workspace_ids: Vec<String>,
) -> WebhookEventStreamServiceImpl<FakeSourceFactory, FakeAccessService, FakeWorkspaceResolver> {
    WebhookEventStreamServiceImpl::new(
        factory,
        Arc::new(access),
        FakeWorkspaceResolver { workspace_ids },
    )
}

#[test]
fn filter_accepts_its_events_and_optional_entity_ids() {
    let document_filter = WebhookFilter {
        events: vec!["document.updated".to_string()],
        ids: Some(vec![DOCUMENT_ID.to_string()]),
    };
    let channel_filter = WebhookFilter {
        events: vec!["channel.message_posted".to_string()],
        ids: None,
    };

    assert!(document_filter.accepts("document.updated", DOCUMENT_ID));
    assert!(!document_filter.accepts("document.updated", OTHER_DOCUMENT_ID));
    assert!(!document_filter.accepts("document.created", DOCUMENT_ID));
    assert!(channel_filter.accepts("channel.message_posted", "any-channel-id"));
}

#[test]
fn stream_start_resumes_at_recent_cursor_and_rejects_stale_cursors() {
    let now_ms = 1_756_000_000_000;
    let window_ms = i64::try_from(MAX_REPLAY_WINDOW.as_millis()).expect("window fits in i64");

    assert_eq!(
        stream_start(None, now_ms).expect("no cursor is valid"),
        StreamStart::Latest
    );

    let recent_ms = now_ms - 60_000;
    let recent_id = uuid_v7_at_ms(recent_ms);
    assert_eq!(
        stream_start(Some(recent_id), now_ms).expect("recent cursor is valid"),
        StreamStart::AtEvent {
            event_id: recent_id,
        }
    );

    let stale_ms = now_ms - 2 * window_ms;
    let error = stream_start(Some(uuid_v7_at_ms(stale_ms)), now_ms)
        .expect_err("cursor older than the replay window is rejected");
    assert!(matches!(error, WebhookStreamError::BadRequest(_)));

    let error = stream_start(Some(Uuid::new_v4()), now_ms).expect_err("v4 cursor is rejected");
    assert!(matches!(error, WebhookStreamError::BadRequest(_)));

    let future =
        uuid_v7_at_ms(now_ms + i64::try_from(MAX_CURSOR_CLOCK_SKEW.as_millis()).unwrap() + 1);
    let error = stream_start(Some(future), now_ms).expect_err("future cursor is rejected");
    assert!(matches!(error, WebhookStreamError::BadRequest(_)));
}

#[tokio::test]
async fn open_stream_delivers_only_matching_accessible_events() {
    let factory = FakeSourceFactory::with_candidates(vec![
        document_candidate("document.updated", DOCUMENT_ID),
        // Filter matches but the subscriber has no access: skipped.
        document_candidate("document.updated", OTHER_DOCUMENT_ID),
        // Access would pass but the filter does not match: skipped.
        document_candidate("document.created", DOCUMENT_ID),
        workspace_candidate("document.updated", SUBSCRIBER_ID),
        workspace_candidate("document.updated", TEAM_WORKSPACE_ID),
        workspace_candidate("document.updated", FOREIGN_WORKSPACE_ID),
    ]);
    let service = service(factory, FakeAccessService::allowing(&[DOCUMENT_ID]));

    let stream = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
            None,
        )
        .await
        .expect("stream opens");
    let delivered: Vec<NormalizedWebhookEvent> = stream.collect().await;

    let delivered_entities: Vec<&str> = delivered
        .iter()
        .map(|event| event.entity_id.as_str())
        .collect();
    assert_eq!(delivered_entities, vec![DOCUMENT_ID, "wh_test"]);
}

#[tokio::test]
async fn team_scope_requires_team_membership() {
    let service = service_with_workspaces(
        FakeSourceFactory::default(),
        FakeAccessService::allowing(&[]),
        vec![SUBSCRIBER_ID.to_string()],
    );

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
async fn open_stream_caches_access_decisions_per_entity() {
    let factory = FakeSourceFactory::with_candidates(vec![
        document_candidate("document.updated", DOCUMENT_ID),
        document_candidate("document.updated", DOCUMENT_ID),
        document_candidate("document.updated", DOCUMENT_ID),
    ]);
    let access = FakeAccessService::allowing(&[DOCUMENT_ID]);
    let call_count = access.call_count.clone();
    let service = service(factory, access);

    let stream = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
            None,
        )
        .await
        .expect("stream opens");
    let delivered: Vec<NormalizedWebhookEvent> = stream.collect().await;

    assert_eq!(delivered.len(), 3);
    assert_eq!(*call_count.lock().unwrap(), 1);
}

#[tokio::test]
async fn open_stream_rejects_empty_or_degenerate_filters() {
    let service = service(
        FakeSourceFactory::default(),
        FakeAccessService::allowing(&[]),
    );

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
async fn open_stream_passes_the_start_through_and_rejects_stale_cursors() {
    let factory = FakeSourceFactory::default();
    let opened_starts = factory.opened_starts.clone();
    let service = service(factory, FakeAccessService::allowing(&[]));

    drop(
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
    let recent_ms = Utc::now().timestamp_millis() - 60_000;
    let recent_id = uuid_v7_at_ms(recent_ms);
    drop(
        service
            .open_stream(
                subscriber(),
                WebhookScope::Team,
                filter(&["document.updated"]),
                Some(recent_id),
            )
            .await
            .expect("stream opens"),
    );

    let starts = opened_starts.lock().unwrap().clone();
    assert_eq!(starts[0], StreamStart::Latest);
    assert_eq!(
        starts[1],
        StreamStart::AtEvent {
            event_id: recent_id,
        }
    );

    let stale_cursor = uuid_v7_at_ms(
        Utc::now().timestamp_millis()
            - 2 * i64::try_from(MAX_REPLAY_WINDOW.as_millis()).expect("window fits in i64"),
    );
    let Err(error) = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
            Some(stale_cursor),
        )
        .await
    else {
        panic!("stale cursor must be rejected");
    };
    assert!(matches!(error, WebhookStreamError::BadRequest(_)));
}
