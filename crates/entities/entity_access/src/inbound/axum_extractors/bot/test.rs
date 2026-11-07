use axum::{
    body::to_bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::BotScope;

use super::*;
use crate::{
    domain::models::{
        BotReceiptScope, EntityPermission, MemberParticipantRole, ParticipantRole, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID, BotAccessCall,
        FakeEntityAccessService, malformed_system_bot_authentication,
        team_scoped_bot_authentication, user_scoped_bot_authentication,
    },
};

async fn response_parts(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("extractor error response body should be readable");
    let body = String::from_utf8(body.to_vec())
        .expect("extractor error response body should be valid UTF-8");

    (status, body)
}

#[test]
fn maps_user_scope_with_verified_acting_user_and_organization() {
    let authentication = user_scoped_bot_authentication();

    let scope = map_bot_access_scope(&authentication).expect("user scope should map");

    match scope {
        BotAccessScope::User {
            user_id,
            user_org_id,
        } => {
            assert_eq!(user_id.as_ref(), BOT_ACTING_USER_ID);
            assert_eq!(
                user_org_id,
                Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID))
            );
        }
        BotAccessScope::Team { .. } => panic!("expected user scope"),
    }
}

#[test]
fn maps_team_scope_with_owning_team() {
    let authentication = team_scoped_bot_authentication();

    let scope = map_bot_access_scope(&authentication).expect("team scope should map");

    assert_eq!(
        scope,
        BotAccessScope::Team {
            team_id: BOT_TEAM_ID
        }
    );
}

#[tokio::test]
async fn malformed_system_authentication_has_scope_specific_rejections() {
    let user_error = map_bot_access_scope(&malformed_system_bot_authentication(BotScope::User))
        .expect_err("user scope without an acting user should fail");
    assert!(matches!(
        user_error,
        ExtractorError::UnauthorizedWithMessage("bot user scope requires an acting user")
    ));
    let (status, body) = response_parts(user_error.into_response()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body,
        r#"{"message":"bot user scope requires an acting user"}"#
    );

    let team_error = map_bot_access_scope(&malformed_system_bot_authentication(BotScope::Team))
        .expect_err("team scope without a team should fail");
    assert!(matches!(team_error, ExtractorError::Unauthorized));
    let (status, body) = response_parts(team_error.into_response()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body,
        r#"{"message":"User does not have access to the requested resource"}"#
    );
}

#[tokio::test]
async fn generic_helper_generates_scoped_receipt_and_records_acl_call() {
    let service =
        FakeEntityAccessService::new(None).with_bot_permission(EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        });
    let authentication = team_scoped_bot_authentication();

    let receipt = generate_bot_entity_access_receipt::<MemberParticipantRole>(
        &service,
        &authentication,
        "channel-1",
        EntityType::Channel,
    )
    .await
    .expect("configured bot permission should generate a receipt");

    assert_eq!(receipt.get_authenticated_bot().unwrap().bot_id(), BOT_ID);
    assert_eq!(
        receipt.get_authenticated_bot_auth().unwrap().scope(),
        &BotReceiptScope::Team {
            team_id: BOT_TEAM_ID
        }
    );
    assert_eq!(
        service.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID
            },
            entity_id: "channel-1".to_string(),
            entity_type: EntityType::Channel,
        }]
    );
}

#[tokio::test]
async fn generic_helper_maps_service_access_errors() {
    let service = FakeEntityAccessService::new(None);
    let authentication = user_scoped_bot_authentication();

    let result = generate_bot_entity_access_receipt::<ViewAccessLevel>(
        &service,
        &authentication,
        "document-1",
        EntityType::Document,
    )
    .await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
    assert_eq!(service.bot_calls().len(), 1);
}
