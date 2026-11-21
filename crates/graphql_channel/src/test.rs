use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Object, Schema};
use channels::domain::models::{Activity, ActivityType};
use entity_access::domain::models::{
    AccessError, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    MemberParticipantRole, ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> bool {
        true
    }
}

#[derive(Default)]
struct CapturingService {
    calls: Mutex<Vec<(String, Uuid, ActivityType)>>,
}

impl ChannelActivityMutationService for CapturingService {
    async fn record_channel_activity(
        &self,
        access: EntityAccessReceipt<MemberParticipantRole>,
        activity_type: ActivityType,
    ) -> Result<Activity, ChannelMutationErr> {
        let user_id = access.get_authenticated_user().unwrap().to_string();
        let channel_id = Uuid::parse_str(&access.entity().entity_id).unwrap();
        self.calls
            .lock()
            .unwrap()
            .push((user_id.clone(), channel_id, activity_type));
        let now = chrono::Utc::now();
        Ok(Activity {
            id: Uuid::new_v4(),
            user_id,
            channel_id,
            created_at: now,
            updated_at: now,
            viewed_at: Some(now),
            interacted_at: None,
        })
    }
}

#[derive(Default)]
struct MemberAuthorizer {
    calls: Mutex<Vec<(String, Uuid)>>,
}

impl ChannelActivityAuthorizer for MemberAuthorizer {
    async fn authorize_channel_member(
        &self,
        user_id: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, AccessError> {
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), channel_id));
        EntityAccessReceipt::try_new(
            EntityAccessAuth::Authenticated(user_id.clone()),
            Entity {
                entity_id: channel_id.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )
    }
}

#[tokio::test]
async fn record_channel_activity_authorizes_and_delegates_only_channel_activity() {
    let service = Arc::new(CapturingService::default());
    let authorizer = Arc::new(MemberAuthorizer::default());
    let user = MacroUserIdStr::try_from_email("user@example.com").unwrap();
    let channel_id = Uuid::new_v4();
    let schema = Schema::build(
        QueryRoot,
        ChannelMutationRoot::<CapturingService, MemberAuthorizer>::new(),
        EmptySubscription,
    )
    .data(service.clone())
    .data(authorizer.clone())
    .data(user)
    .finish();

    let response = schema
        .execute(format!(
            r#"mutation {{ recordChannelActivity(input: {{ channelId: "{channel_id}", activityType: VIEW }}) {{ id channelId userId viewedAt interactedAt }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["recordChannelActivity"]["channelId"],
        channel_id.to_string()
    );
    assert!(data["recordChannelActivity"]["viewedAt"].is_string());
    assert!(data["recordChannelActivity"]["interactedAt"].is_null());
    assert_eq!(authorizer.calls.lock().unwrap().len(), 1);
    assert_eq!(
        service.calls.lock().unwrap().as_slice(),
        [(
            "macro|user@example.com".to_string(),
            channel_id,
            ActivityType::View,
        ),]
    );
}

/// Answers one DM and records who asked about whom.
#[derive(Default)]
struct FakeFinder {
    calls: Mutex<Vec<(String, String)>>,
    views: Mutex<Vec<(String, Uuid)>>,
}

impl ChannelUserReads for FakeFinder {
    async fn find_direct_message(
        &self,
        user_id: MacroUserIdStr<'static>,
        recipient_id: MacroUserIdStr<'static>,
    ) -> Result<Option<Uuid>, ChannelMessagesErr> {
        let found = (recipient_id.as_ref() == "macro|known@example.com").then_some(DM_ID);
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), recipient_id.to_string()));
        Ok(found)
    }

    async fn channel_viewed_at(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<Option<DateTime<Utc>>, ChannelMessagesErr> {
        self.views
            .lock()
            .unwrap()
            .push((user_id.to_string(), channel_id));
        Ok((channel_id == VIEWED_ID).then(viewed_at))
    }
}

const VIEWED_ID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_00e0);

fn viewed_at() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-11-20T10:00:00.123456Z")
        .unwrap()
        .with_timezone(&Utc)
}

const DM_ID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_00d0);

/// The viewer root the composed schema flattens the channel fields into.
struct ViewerRoot {
    user_id: MacroUserIdStr<'static>,
}

#[Object]
impl ViewerRoot {
    /// An object needs a field of its own beside the flattened ones.
    async fn health(&self) -> bool {
        true
    }

    #[graphql(flatten)]
    async fn channels(&self) -> GraphqlChannelUserQuery {
        GraphqlChannelUserQuery::new(self.user_id.clone())
    }
}

/// A finder whose read fails.
struct FailingFinder;

impl ChannelUserReads for FailingFinder {
    async fn find_direct_message(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _recipient_id: MacroUserIdStr<'static>,
    ) -> Result<Option<Uuid>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::MessageNotFound(DM_ID))
    }

    async fn channel_viewed_at(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _channel_id: Uuid,
    ) -> Result<Option<DateTime<Utc>>, ChannelMessagesErr> {
        Err(ChannelMessagesErr::MessageNotFound(VIEWED_ID))
    }
}

async fn ask_direct_message<F: ChannelUserReads>(
    finder: Arc<F>,
    user_id: &str,
) -> async_graphql::Response {
    ask_viewer(
        finder,
        format!(r#"{{ directMessageChannelId(userId: "{user_id}") }}"#),
    )
    .await
}

async fn ask_viewer<F: ChannelUserReads>(finder: Arc<F>, query: String) -> async_graphql::Response {
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    Schema::build(
        ViewerRoot { user_id: viewer },
        async_graphql::EmptyMutation,
        EmptySubscription,
    )
    .data(ChannelQueryContext::new(finder))
    .finish()
    .execute(query)
    .await
}

async fn ask_viewed_at<F: ChannelUserReads>(
    finder: Arc<F>,
    channel_id: &str,
) -> async_graphql::Response {
    ask_viewer(
        finder,
        format!(r#"{{ channelViewedAt(channelId: "{channel_id}") }}"#),
    )
    .await
}

#[tokio::test]
async fn direct_message_channel_id_asks_for_the_viewer_and_the_named_person() {
    let finder = Arc::new(FakeFinder::default());

    let known = ask_direct_message(finder.clone(), "macro|known@example.com").await;
    assert!(known.errors.is_empty(), "{:?}", known.errors);
    assert_eq!(
        known.data.into_json().unwrap()["directMessageChannelId"],
        DM_ID.to_string()
    );

    let stranger = ask_direct_message(finder.clone(), "macro|stranger@example.com").await;
    assert!(stranger.errors.is_empty(), "{:?}", stranger.errors);
    assert!(stranger.data.into_json().unwrap()["directMessageChannelId"].is_null());

    assert_eq!(
        finder.calls.lock().unwrap().as_slice(),
        [
            (
                "macro|viewer@example.com".to_string(),
                "macro|known@example.com".to_string()
            ),
            (
                "macro|viewer@example.com".to_string(),
                "macro|stranger@example.com".to_string()
            ),
        ]
    );
}

#[tokio::test]
async fn direct_message_channel_id_rejects_a_malformed_user_id_without_reading() {
    let finder = Arc::new(FakeFinder::default());

    let response = ask_direct_message(finder.clone(), "not-a-user").await;

    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    assert!(
        response.errors[0].message.contains("invalid userId"),
        "{:?}",
        response.errors
    );
    assert!(finder.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn direct_message_channel_id_hides_a_repository_failure_behind_a_code() {
    let response = ask_direct_message(Arc::new(FailingFinder), "macro|known@example.com").await;

    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    let error = &response.errors[0];
    assert_eq!(error.message, "direct message lookup failed");
    assert_eq!(
        error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("code"))
            .cloned(),
        Some(async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
    );
}

#[tokio::test]
async fn channel_viewed_at_answers_for_the_viewer_and_the_named_channel() {
    let finder = Arc::new(FakeFinder::default());

    let viewed = ask_viewed_at(finder.clone(), &VIEWED_ID.to_string()).await;
    assert!(viewed.errors.is_empty(), "{:?}", viewed.errors);
    assert_eq!(
        viewed.data.into_json().unwrap()["channelViewedAt"],
        viewed_at().to_rfc3339()
    );

    let never = ask_viewed_at(finder.clone(), &DM_ID.to_string()).await;
    assert!(never.errors.is_empty(), "{:?}", never.errors);
    assert!(never.data.into_json().unwrap()["channelViewedAt"].is_null());

    assert_eq!(
        finder.views.lock().unwrap().as_slice(),
        [
            ("macro|viewer@example.com".to_string(), VIEWED_ID),
            ("macro|viewer@example.com".to_string(), DM_ID),
        ]
    );
}

#[tokio::test]
async fn channel_viewed_at_rejects_a_malformed_channel_id_without_reading() {
    let finder = Arc::new(FakeFinder::default());

    let response = ask_viewed_at(finder.clone(), "not-a-uuid").await;

    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    assert!(finder.views.lock().unwrap().is_empty());
}

#[tokio::test]
async fn channel_viewed_at_hides_a_repository_failure_behind_a_code() {
    let response = ask_viewed_at(Arc::new(FailingFinder), &VIEWED_ID.to_string()).await;

    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    let error = &response.errors[0];
    assert_eq!(error.message, "channel view lookup failed");
    assert_eq!(
        error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("code"))
            .cloned(),
        Some(async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
    );
}
