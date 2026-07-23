use std::sync::{Arc, Mutex};

use bot_id::BotId;
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{BotAuthorizationOwner, BotTokenAuthorization},
    ports::BotAuthorizationRepo,
};

const RAW_TOKEN: &str = "mbot_test_secret";
const OWNER_ID: &str = "macro|owner@example.com";
const FUSION_USER_ID: &str = "fusion-owner";
const ORGANIZATION_ID: i32 = 42;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Failure {
    FindToken,
    MarkTokenUsed,
    FindActingUser,
    UserHasTeam,
}

#[derive(Debug, Default)]
struct Calls {
    tokens: Vec<String>,
    marked_token_ids: Vec<Uuid>,
    acting_user_claims: Vec<BotActingUserClaims>,
    team_lookups: Vec<(String, Uuid)>,
}

#[derive(Clone)]
struct FakeRepo {
    token: Option<BotTokenAuthorization>,
    acting_user: Option<ResolvedBotActingUser>,
    user_has_team: bool,
    failure: Option<Failure>,
    calls: Arc<Mutex<Calls>>,
}

impl FakeRepo {
    fn owned_by_user() -> Self {
        Self {
            token: Some(BotTokenAuthorization {
                bot_id: BotId::new_from_uuid(Uuid::from_u128(1)),
                token_id: Uuid::from_u128(2),
                owner: BotAuthorizationOwner::User {
                    user_id: OWNER_ID.to_string(),
                },
            }),
            acting_user: Some(resolved_user()),
            user_has_team: true,
            failure: None,
            calls: Arc::new(Mutex::new(Calls::default())),
        }
    }

    fn fail_at(mut self, failure: Failure) -> Self {
        self.failure = Some(failure);
        self
    }
}

impl BotAuthorizationRepo for FakeRepo {
    type Err = &'static str;

    async fn find_valid_bot_token(
        &self,
        token: &str,
    ) -> Result<Option<BotTokenAuthorization>, Self::Err> {
        self.calls.lock().unwrap().tokens.push(token.to_string());
        if self.failure == Some(Failure::FindToken) {
            return Err("find token failed");
        }
        Ok(self.token.clone())
    }

    async fn mark_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        self.calls.lock().unwrap().marked_token_ids.push(token_id);
        if self.failure == Some(Failure::MarkTokenUsed) {
            return Err("mark used failed");
        }
        Ok(())
    }

    async fn find_acting_user(
        &self,
        claims: &BotActingUserClaims,
    ) -> Result<Option<ResolvedBotActingUser>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .acting_user_claims
            .push(claims.clone());
        if self.failure == Some(Failure::FindActingUser) {
            return Err("find user failed");
        }
        Ok(self.acting_user.clone())
    }

    async fn user_has_team(&self, fusion_user_id: &str, team_id: Uuid) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .team_lookups
            .push((fusion_user_id.to_string(), team_id));
        if self.failure == Some(Failure::UserHasTeam) {
            return Err("team lookup failed");
        }
        Ok(self.user_has_team)
    }
}

fn resolved_user() -> ResolvedBotActingUser {
    ResolvedBotActingUser {
        macro_user_id: MacroUserIdStr::try_from(OWNER_ID.to_string()).unwrap(),
        fusion_user_id: FUSION_USER_ID.to_string(),
        organization_id: Some(ORGANIZATION_ID),
    }
}

fn claims() -> BotActingUserClaims {
    BotActingUserClaims {
        user_id: Some(OWNER_ID.to_string()),
        fusion_user_id: Some(FUSION_USER_ID.to_string()),
        organization_id: Some(ORGANIZATION_ID),
    }
}

fn assert_error(
    result: Result<BotAuthentication, Report<MacroAuthorizationError>>,
    expected: MacroAuthorizationError,
) {
    assert_eq!(result.unwrap_err().current_context(), &expected);
}

#[tokio::test]
async fn authorizes_bare_bot_and_marks_the_valid_token_used() {
    let repo = FakeRepo::owned_by_user();
    let authentication = BotAuthorizerService::new(repo.clone())
        .authorize_bot(RAW_TOKEN, BotScope::User, None)
        .await
        .unwrap();

    let token = repo.token.as_ref().unwrap();
    assert_eq!(authentication.bot_id, token.bot_id);
    assert_eq!(authentication.token_id, token.token_id);
    assert_eq!(authentication.bot_scope, BotScope::User);
    assert_eq!(authentication.team_id, None);
    assert!(authentication.acting_user.is_none());

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.tokens, [RAW_TOKEN]);
    assert_eq!(calls.marked_token_ids, [token.token_id]);
    assert!(calls.acting_user_claims.is_empty());
}

#[tokio::test]
async fn authorizes_exact_user_owner_with_consistent_claims() {
    let repo = FakeRepo::owned_by_user();
    let authentication = BotAuthorizerService::new(repo.clone())
        .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims()))
        .await
        .unwrap();

    assert_eq!(authentication.bot_scope, BotScope::User);
    assert_eq!(authentication.team_id, None);
    let acting_user = authentication.acting_user.unwrap();
    assert_eq!(acting_user.macro_user_id.as_ref(), OWNER_ID);
    assert_eq!(acting_user.user_context.user_id, OWNER_ID);
    assert_eq!(acting_user.user_context.fusion_user_id, FUSION_USER_ID);
    assert_eq!(
        acting_user.user_context.organization_id,
        Some(ORGANIZATION_ID)
    );
    assert_eq!(acting_user.user_context.permissions, None);
    assert_eq!(repo.calls.lock().unwrap().acting_user_claims, [claims()]);
}

#[tokio::test]
async fn rejects_team_scope_for_user_and_system_bots() {
    for owner in [
        BotAuthorizationOwner::User {
            user_id: OWNER_ID.to_string(),
        },
        BotAuthorizationOwner::System,
    ] {
        let mut repo = FakeRepo::owned_by_user();
        repo.token.as_mut().unwrap().owner = owner;
        let token_id = repo.token.as_ref().unwrap().token_id;

        let result = BotAuthorizerService::new(repo.clone())
            .authorize_bot(RAW_TOKEN, BotScope::Team, None)
            .await;

        assert_error(result, MacroAuthorizationError::BotScopeNotAuthorized);
        let calls = repo.calls.lock().unwrap();
        assert_eq!(calls.marked_token_ids, [token_id]);
        assert!(calls.acting_user_claims.is_empty());
        assert!(calls.team_lookups.is_empty());
    }
}

#[tokio::test]
async fn user_scope_preserves_the_owning_team_id() {
    let team_id = Uuid::from_u128(3);
    let mut repo = FakeRepo::owned_by_user();
    repo.token.as_mut().unwrap().owner = BotAuthorizationOwner::Team { team_id };

    let authentication = BotAuthorizerService::new(repo.clone())
        .authorize_bot(RAW_TOKEN, BotScope::User, None)
        .await
        .unwrap();

    assert_eq!(authentication.bot_scope, BotScope::User);
    assert_eq!(authentication.team_id, Some(team_id));
    assert!(repo.calls.lock().unwrap().team_lookups.is_empty());
}

#[tokio::test]
async fn authorizes_current_team_member_and_rejects_non_member() {
    let team_id = Uuid::from_u128(3);
    for (has_team, expected) in [
        (true, None),
        (
            false,
            Some(MacroAuthorizationError::ActingUserNotAuthorized),
        ),
    ] {
        let mut repo = FakeRepo::owned_by_user();
        repo.token.as_mut().unwrap().owner = BotAuthorizationOwner::Team { team_id };
        repo.user_has_team = has_team;

        let result = BotAuthorizerService::new(repo.clone())
            .authorize_bot(RAW_TOKEN, BotScope::Team, Some(claims()))
            .await;

        if let Some(expected) = expected {
            assert_error(result, expected);
        } else {
            let authentication = result.unwrap();
            assert_eq!(authentication.bot_scope, BotScope::Team);
            assert_eq!(authentication.team_id, Some(team_id));
        }
        assert_eq!(
            repo.calls.lock().unwrap().team_lookups,
            [(FUSION_USER_ID.to_string(), team_id)]
        );
    }
}

#[tokio::test]
async fn rejects_system_bot_claims_before_user_lookups() {
    let mut repo = FakeRepo::owned_by_user();
    repo.token.as_mut().unwrap().owner = BotAuthorizationOwner::System;

    let result = BotAuthorizerService::new(repo.clone())
        .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims()))
        .await;

    assert_error(result, MacroAuthorizationError::ActingUserNotAuthorized);
    assert!(repo.calls.lock().unwrap().acting_user_claims.is_empty());
}

#[tokio::test]
async fn rejects_missing_malformed_or_inconsistent_acting_user_claims() {
    let invalid_claims = [
        BotActingUserClaims {
            user_id: None,
            fusion_user_id: None,
            organization_id: Some(ORGANIZATION_ID),
        },
        BotActingUserClaims {
            user_id: Some("not-a-macro-user-id".to_string()),
            fusion_user_id: None,
            organization_id: None,
        },
        BotActingUserClaims {
            fusion_user_id: Some("different-fusion-user".to_string()),
            ..claims()
        },
        BotActingUserClaims {
            organization_id: Some(ORGANIZATION_ID + 1),
            ..claims()
        },
    ];

    for claims in invalid_claims {
        let result = BotAuthorizerService::new(FakeRepo::owned_by_user())
            .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims))
            .await;
        assert_error(result, MacroAuthorizationError::ActingUserNotAuthorized);
    }
}

#[tokio::test]
async fn rejects_unknown_token_without_marking_or_policy_lookups() {
    let mut repo = FakeRepo::owned_by_user();
    repo.token = None;

    let result = BotAuthorizerService::new(repo.clone())
        .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims()))
        .await;

    assert_error(result, MacroAuthorizationError::InvalidCredentials);
    let calls = repo.calls.lock().unwrap();
    assert!(calls.marked_token_ids.is_empty());
    assert!(calls.acting_user_claims.is_empty());
}

#[tokio::test]
async fn maps_repository_failures_to_unavailable() {
    for failure in [
        Failure::FindToken,
        Failure::MarkTokenUsed,
        Failure::FindActingUser,
    ] {
        let result = BotAuthorizerService::new(FakeRepo::owned_by_user().fail_at(failure))
            .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims()))
            .await;
        assert_error(result, MacroAuthorizationError::Unavailable);
    }

    let team_id = Uuid::from_u128(3);
    let mut repo = FakeRepo::owned_by_user().fail_at(Failure::UserHasTeam);
    repo.token.as_mut().unwrap().owner = BotAuthorizationOwner::Team { team_id };
    let result = BotAuthorizerService::new(repo)
        .authorize_bot(RAW_TOKEN, BotScope::User, Some(claims()))
        .await;
    assert_error(result, MacroAuthorizationError::Unavailable);
}
