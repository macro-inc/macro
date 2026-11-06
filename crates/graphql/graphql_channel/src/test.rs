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
