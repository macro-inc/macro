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
use tokio::sync::broadcast;
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

fn filter(events: &[&str]) -> WebhookFilters {
    vec![WebhookFilter {
        events: events.iter().map(|event| event.to_string()).collect(),
        ids: None,
    }]
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

type TestService = WebhookEventStreamServiceImpl<FakeAccessService, FakeWorkspaceResolver>;

fn service(access: FakeAccessService) -> (TestService, broadcast::Sender<StreamCandidateEvent>) {
    service_with_workspaces(
        access,
        vec![SUBSCRIBER_ID.to_string(), TEAM_WORKSPACE_ID.to_string()],
    )
}

fn service_with_workspaces(
    access: FakeAccessService,
    workspace_ids: Vec<String>,
) -> (TestService, broadcast::Sender<StreamCandidateEvent>) {
    let (sender, _) = broadcast::channel(16);
    let service = WebhookEventStreamServiceImpl::new(
        sender.clone(),
        Arc::new(access),
        FakeWorkspaceResolver { workspace_ids },
    );
    (service, sender)
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
    let (service, sender) = service(FakeAccessService::allowing(&[DOCUMENT_ID]));

    let stream = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
        )
        .await
        .expect("stream opens");
    for candidate in candidates {
        sender.send(candidate).unwrap();
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
    let (service, _) = service_with_workspaces(
        FakeAccessService::allowing(&[]),
        vec![SUBSCRIBER_ID.to_string()],
    );

    let Err(error) = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["webhook.updated"]),
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
    let call_count = access.call_count.clone();
    let (service, sender) = service(access);

    let stream = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
        )
        .await
        .expect("stream opens");
    for candidate in candidates {
        sender.send(candidate).unwrap();
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
            .open_stream(subscriber(), WebhookScope::Team, filters)
            .await
        else {
            panic!("degenerate filters must be rejected");
        };
        assert!(matches!(error, WebhookStreamError::BadRequest(_)));
    }
}

#[tokio::test]
async fn lagged_stream_skips_missed_events_and_continues() {
    let (sender, _) = broadcast::channel(2);
    let service = WebhookEventStreamServiceImpl::new(
        sender.clone(),
        Arc::new(FakeAccessService::allowing(&[DOCUMENT_ID])),
        FakeWorkspaceResolver {
            workspace_ids: vec![SUBSCRIBER_ID.to_string(), TEAM_WORKSPACE_ID.to_string()],
        },
    );
    let mut stream = service
        .open_stream(
            subscriber(),
            WebhookScope::Team,
            filter(&["document.updated"]),
        )
        .await
        .expect("stream opens");

    sender
        .send(document_candidate("document.updated", DOCUMENT_ID))
        .unwrap();
    sender
        .send(document_candidate("document.updated", DOCUMENT_ID))
        .unwrap();
    let latest = document_candidate("document.updated", DOCUMENT_ID);
    let latest_id = latest.event.event_id.clone();
    sender.send(latest).unwrap();

    let delivered = stream.next().await.expect("stream continues after lag");
    assert_ne!(delivered.event_id, latest_id);
    assert_eq!(stream.next().await.unwrap().event_id, latest_id);
}
