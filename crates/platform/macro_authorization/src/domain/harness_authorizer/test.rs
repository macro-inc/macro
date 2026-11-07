use std::sync::{Arc, Mutex};

use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::ports::HarnessAuthorizationRepo;

const RAW_TOKEN: &str = "mhns_test_secret";
const OWNER_ID: &str = "macro|owner@example.com";
const MEMBER_ID: &str = "macro|member@example.com";
const FUSION_USER_ID: &str = "fusion-owner";
const TEAM_ID: Uuid = Uuid::from_u128(3);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Failure {
    FindToken,
    MarkTokenUsed,
    FindUser,
    UserHasTeam,
}

#[derive(Debug, Default)]
struct Calls {
    tokens: Vec<String>,
    marked_token_ids: Vec<Uuid>,
    user_lookups: Vec<String>,
    team_lookups: Vec<(String, Uuid)>,
}

#[derive(Clone)]
struct FakeRepo {
    token: Option<HarnessTokenAuthorization>,
    user: Option<ResolvedBotActingUser>,
    user_has_team: bool,
    failure: Option<Failure>,
    calls: Arc<Mutex<Calls>>,
}

impl FakeRepo {
    fn owned_by_user() -> Self {
        Self {
            token: Some(HarnessTokenAuthorization {
                harness_id: HarnessId::TEST_A,
                token_id: Uuid::from_u128(2),
                owner: HarnessAuthorizationOwner::User {
                    user_id: OWNER_ID.to_string(),
                },
                created_by: OWNER_ID.to_string(),
            }),
            user: Some(resolved_user(OWNER_ID)),
            user_has_team: true,
            failure: None,
            calls: Arc::new(Mutex::new(Calls::default())),
        }
    }

    fn owned_by_team() -> Self {
        let mut repo = Self::owned_by_user();
        let token = repo.token.as_mut().unwrap();
        token.owner = HarnessAuthorizationOwner::Team { team_id: TEAM_ID };
        repo
    }

    fn fail_at(mut self, failure: Failure) -> Self {
        self.failure = Some(failure);
        self
    }
}

impl HarnessAuthorizationRepo for FakeRepo {
    type Err = &'static str;

    async fn find_valid_harness_token(
        &self,
        token: &str,
    ) -> Result<Option<HarnessTokenAuthorization>, Self::Err> {
        self.calls.lock().unwrap().tokens.push(token.to_string());
        if self.failure == Some(Failure::FindToken) {
            return Err("find token failed");
        }
        Ok(self.token.clone())
    }

    async fn mark_harness_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        self.calls.lock().unwrap().marked_token_ids.push(token_id);
        if self.failure == Some(Failure::MarkTokenUsed) {
            return Err("mark used failed");
        }
        Ok(())
    }

    async fn find_user(
        &self,
        macro_user_id: &str,
    ) -> Result<Option<ResolvedBotActingUser>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .user_lookups
            .push(macro_user_id.to_string());
        if self.failure == Some(Failure::FindUser) {
            return Err("find user failed");
        }
        Ok(self
            .user
            .clone()
            .filter(|user| user.macro_user_id.as_ref() == macro_user_id))
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

fn resolved_user(macro_user_id: &str) -> ResolvedBotActingUser {
    ResolvedBotActingUser {
        macro_user_id: MacroUserIdStr::try_from(macro_user_id.to_string()).unwrap(),
        fusion_user_id: FUSION_USER_ID.to_string(),
        organization_id: Some(42),
    }
}

fn assert_error(
    result: Result<HarnessAuthentication, Report<MacroAuthorizationError>>,
    expected: MacroAuthorizationError,
) {
    assert_eq!(result.unwrap_err().current_context(), &expected);
}

#[tokio::test]
async fn authorizes_private_harness_with_owner_as_default_acting_user() {
    let repo = FakeRepo::owned_by_user();
    let authentication = HarnessAuthorizerService::new(repo.clone())
        .authorize_harness(RAW_TOKEN, None)
        .await
        .unwrap();

    let token = repo.token.as_ref().unwrap();
    assert_eq!(authentication.harness_id, token.harness_id);
    assert_eq!(authentication.token_id, token.token_id);
    assert_eq!(authentication.acting_user.macro_user_id.as_ref(), OWNER_ID);

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.tokens, [RAW_TOKEN]);
    assert_eq!(calls.marked_token_ids, [token.token_id]);
    assert_eq!(calls.user_lookups, [OWNER_ID]);
    assert!(calls.team_lookups.is_empty());
}

#[tokio::test]
async fn team_harness_defaults_to_its_creator_and_checks_membership() {
    let repo = FakeRepo::owned_by_team();
    let authentication = HarnessAuthorizerService::new(repo.clone())
        .authorize_harness(RAW_TOKEN, None)
        .await
        .unwrap();

    assert_eq!(authentication.acting_user.macro_user_id.as_ref(), OWNER_ID);
    assert_eq!(
        repo.calls.lock().unwrap().team_lookups,
        [(FUSION_USER_ID.to_string(), TEAM_ID)]
    );
}

#[tokio::test]
async fn verified_claim_becomes_the_acting_user_for_team_members() {
    let mut repo = FakeRepo::owned_by_team();
    repo.user = Some(resolved_user(MEMBER_ID));

    let authentication = HarnessAuthorizerService::new(repo.clone())
        .authorize_harness(RAW_TOKEN, Some(MEMBER_ID.to_string()))
        .await
        .unwrap();

    assert_eq!(authentication.acting_user.macro_user_id.as_ref(), MEMBER_ID);
    assert_eq!(repo.calls.lock().unwrap().user_lookups, [MEMBER_ID]);
}

#[tokio::test]
async fn rejects_claims_for_users_outside_the_owning_team() {
    let mut repo = FakeRepo::owned_by_team();
    repo.user = Some(resolved_user(MEMBER_ID));
    repo.user_has_team = false;

    let result = HarnessAuthorizerService::new(repo)
        .authorize_harness(RAW_TOKEN, Some(MEMBER_ID.to_string()))
        .await;

    assert_error(result, MacroAuthorizationError::ActingUserNotAuthorized);
}

#[tokio::test]
async fn private_harness_rejects_claims_for_anyone_but_the_owner() {
    let mut repo = FakeRepo::owned_by_user();
    repo.user = Some(resolved_user(MEMBER_ID));

    let result = HarnessAuthorizerService::new(repo)
        .authorize_harness(RAW_TOKEN, Some(MEMBER_ID.to_string()))
        .await;

    assert_error(result, MacroAuthorizationError::ActingUserNotAuthorized);
}

#[tokio::test]
async fn rejects_claims_for_unknown_users() {
    let repo = FakeRepo::owned_by_user();

    let result = HarnessAuthorizerService::new(repo)
        .authorize_harness(RAW_TOKEN, Some("macro|nobody@example.com".to_string()))
        .await;

    assert_error(result, MacroAuthorizationError::ActingUserNotAuthorized);
}

#[tokio::test]
async fn rejects_unknown_token_without_marking_or_policy_lookups() {
    let mut repo = FakeRepo::owned_by_user();
    repo.token = None;

    let result = HarnessAuthorizerService::new(repo.clone())
        .authorize_harness(RAW_TOKEN, None)
        .await;

    assert_error(result, MacroAuthorizationError::InvalidCredentials);
    let calls = repo.calls.lock().unwrap();
    assert!(calls.marked_token_ids.is_empty());
    assert!(calls.user_lookups.is_empty());
}

#[tokio::test]
async fn maps_repository_failures_to_unavailable() {
    for failure in [
        Failure::FindToken,
        Failure::MarkTokenUsed,
        Failure::FindUser,
    ] {
        let result = HarnessAuthorizerService::new(FakeRepo::owned_by_user().fail_at(failure))
            .authorize_harness(RAW_TOKEN, None)
            .await;
        assert_error(result, MacroAuthorizationError::Unavailable);
    }

    let result =
        HarnessAuthorizerService::new(FakeRepo::owned_by_team().fail_at(Failure::UserHasTeam))
            .authorize_harness(RAW_TOKEN, None)
            .await;
    assert_error(result, MacroAuthorizationError::Unavailable);
}
