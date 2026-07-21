use super::*;
use crate::domain::{
    models::{
        ActingUserClaims, AuthenticatedBot, BotKind, BotOwner, BotToken, BotTokenCandidate,
        CreateBotRequest, CreateBotTokenRequest, CreateChannelScopedBotRequest, PatchBotRequest,
    },
    ports::{BotRepo, BotService},
};
use chrono::Duration;
use macro_event_broker::NoopMacroEventBroker;
use std::sync::{Arc, Mutex};

const RAW_TOKEN: &str = "mbot_test_secret";
const OWNER_ID: &str = "macro|owner@example.com";
const FUSION_USER_ID: &str = "fusion-owner";
const ORGANIZATION_ID: i32 = 42;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RepositoryFailure {
    TokenCandidate,
    MarkTokenUsed,
    FindActingUser,
    GetBot,
    UserHasTeam,
    BotActiveInChannel,
}

#[derive(Debug, Default)]
struct RepositoryCalls {
    token_candidates: Vec<String>,
    channel_token_candidates: Vec<(Uuid, String)>,
    marked_token_ids: Vec<Uuid>,
    acting_user_claims: Vec<ActingUserClaims>,
    bot_ids: Vec<BotId>,
    team_lookups: Vec<(String, Uuid)>,
    channel_lookups: Vec<(Uuid, BotId)>,
}

#[derive(Clone)]
struct FakeBotRepo {
    candidate: Option<BotTokenCandidate>,
    bot: Option<Bot>,
    acting_user: Option<ActingUser>,
    user_has_team: bool,
    bot_active_in_channel: bool,
    failure: Option<RepositoryFailure>,
    calls: Arc<Mutex<RepositoryCalls>>,
}

impl FakeBotRepo {
    fn new(bot_id: BotId, token_id: Uuid) -> Self {
        Self {
            candidate: Some(token_candidate(bot_id, token_id, BotKind::Owned)),
            bot: Some(bot(bot_id, BotKind::Owned, Some(user_owner(OWNER_ID)))),
            acting_user: Some(acting_user()),
            user_has_team: true,
            bot_active_in_channel: true,
            failure: None,
            calls: Arc::new(Mutex::new(RepositoryCalls::default())),
        }
    }

    fn fail_at(mut self, failure: RepositoryFailure) -> Self {
        self.failure = Some(failure);
        self
    }

    fn fails_at(&self, failure: RepositoryFailure) -> bool {
        self.failure == Some(failure)
    }

    fn repository_error() -> anyhow::Error {
        anyhow::anyhow!("fake repository failure")
    }
}

impl BotRepo for FakeBotRepo {
    type Err = anyhow::Error;

    async fn create_owned_bot(
        &self,
        _owner: BotOwner,
        _created_by: MacroUserIdStr<'static>,
        _req: CreateBotRequest,
    ) -> Result<Bot, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn create_channel_scoped_bot(
        &self,
        _owner: BotOwner,
        _created_by: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _token: String,
        _req: CreateChannelScopedBotRequest,
    ) -> Result<(Bot, BotToken), Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn list_manageable_bots(
        &self,
        _caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Bot>, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn get_bot(&self, bot_id: BotId) -> Result<Option<Bot>, Self::Err> {
        self.calls.lock().unwrap().bot_ids.push(bot_id);
        if self.fails_at(RepositoryFailure::GetBot) {
            return Err(Self::repository_error());
        }
        Ok(self.bot.clone())
    }

    async fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .team_lookups
            .push((caller.as_ref().to_string(), team_id));
        if self.fails_at(RepositoryFailure::UserHasTeam) {
            return Err(Self::repository_error());
        }
        Ok(self.user_has_team)
    }

    async fn find_acting_user(
        &self,
        claims: &ActingUserClaims,
    ) -> Result<Option<ActingUser>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .acting_user_claims
            .push(claims.clone());
        if self.fails_at(RepositoryFailure::FindActingUser) {
            return Err(Self::repository_error());
        }
        Ok(self.acting_user.clone())
    }

    async fn bot_active_in_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .channel_lookups
            .push((channel_id, bot_id));
        if self.fails_at(RepositoryFailure::BotActiveInChannel) {
            return Err(Self::repository_error());
        }
        Ok(self.bot_active_in_channel)
    }

    async fn patch_bot(
        &self,
        _bot_id: BotId,
        _req: PatchBotRequest,
    ) -> Result<Option<Bot>, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn delete_bot(&self, _bot_id: BotId) -> Result<bool, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn add_bot_to_channel(&self, _channel_id: Uuid, _bot_id: BotId) -> Result<(), Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn remove_bot_from_channel(
        &self,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<bool, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn list_bot_channels(&self, _bot_id: BotId) -> Result<Vec<BotChannel>, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn list_channel_bots(&self, _channel_id: Uuid) -> Result<Vec<Bot>, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn create_token(
        &self,
        _bot_id: BotId,
        _token: String,
        _req: CreateBotTokenRequest,
    ) -> Result<BotToken, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn list_tokens(&self, _bot_id: BotId) -> Result<Vec<BotToken>, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn revoke_token(&self, _bot_id: BotId, _token_id: Uuid) -> Result<bool, Self::Err> {
        unimplemented!("not needed by bot authorization tests")
    }

    async fn token_candidate(&self, token: &str) -> Result<Option<BotTokenCandidate>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .token_candidates
            .push(token.to_string());
        if self.fails_at(RepositoryFailure::TokenCandidate) {
            return Err(Self::repository_error());
        }
        Ok(self.candidate.clone())
    }

    async fn channel_token_candidate(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> Result<Option<BotTokenCandidate>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .channel_token_candidates
            .push((channel_id, token.to_string()));
        Ok(self.candidate.clone())
    }

    async fn mark_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        self.calls.lock().unwrap().marked_token_ids.push(token_id);
        if self.fails_at(RepositoryFailure::MarkTokenUsed) {
            return Err(Self::repository_error());
        }
        Ok(())
    }
}

fn service(repo: FakeBotRepo) -> BotServiceImpl<FakeBotRepo, NoopMacroEventBroker> {
    BotServiceImpl::new(repo, NoopMacroEventBroker)
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid Macro user id")
}

fn acting_user() -> ActingUser {
    ActingUser {
        macro_user_id: user_id(OWNER_ID),
        fusion_user_id: FUSION_USER_ID.to_string(),
        organization_id: Some(ORGANIZATION_ID),
    }
}

fn claims() -> ActingUserClaims {
    ActingUserClaims {
        user_id: Some(OWNER_ID.to_string()),
        fusion_user_id: Some(FUSION_USER_ID.to_string()),
        organization_id: Some(ORGANIZATION_ID),
    }
}

fn user_owner(user_id: &str) -> BotOwner {
    BotOwner::User {
        user_id: user_id.to_string(),
    }
}

fn bot(bot_id: BotId, kind: BotKind, owner: Option<BotOwner>) -> Bot {
    let now = Utc::now();
    Bot {
        id: bot_id,
        kind,
        owner,
        name: "Test bot".to_string(),
        handle: "test-bot".to_string(),
        description: None,
        avatar_url: None,
        created_by: None,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    }
}

fn token_candidate(bot_id: BotId, token_id: Uuid, kind: BotKind) -> BotTokenCandidate {
    let now = Utc::now();
    BotTokenCandidate {
        token: BotToken {
            id: token_id,
            bot_id,
            token: RAW_TOKEN.to_string(),
            label: None,
            last_used_at: None,
            expires_at: None,
            revoked_at: None,
            created_at: now,
        },
        bot: AuthenticatedBot { bot_id, kind },
    }
}

fn assert_forbidden(result: Result<AuthorizedBotPrincipal, BotError>) {
    assert!(matches!(result, Err(BotError::ForbiddenActingUser)));
}

fn assert_repo_error<T>(result: Result<T, BotError>) {
    assert!(matches!(result, Err(BotError::Repo(_))));
}

#[tokio::test]
async fn authorizes_bare_bot_and_retains_only_validated_identity() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);

    let principal = service(repo.clone())
        .authorize_bot_request(RAW_TOKEN, None)
        .await
        .unwrap();

    assert_eq!(principal.bot.bot_id, bot_id);
    assert_eq!(principal.bot.kind, BotKind::Owned);
    assert_eq!(principal.token_id, token_id);
    assert!(principal.acting_user.is_none());

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.token_candidates, [RAW_TOKEN]);
    assert_eq!(calls.marked_token_ids, [token_id]);
    assert!(calls.acting_user_claims.is_empty());
    assert!(calls.bot_ids.is_empty());
    assert!(calls.team_lookups.is_empty());
}

#[tokio::test]
async fn authorizes_exact_user_owner_with_consistent_claims() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);

    let principal = service(repo.clone())
        .authorize_bot_request(RAW_TOKEN, Some(claims()))
        .await
        .unwrap();

    assert_eq!(principal.acting_user, Some(acting_user()));
    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.marked_token_ids, [token_id]);
    assert_eq!(calls.acting_user_claims, [claims()]);
    assert_eq!(calls.bot_ids, [bot_id]);
    assert!(calls.team_lookups.is_empty());
}

#[tokio::test]
async fn authorizes_either_macro_or_fusion_identifier() {
    let identifier_claims = [
        ActingUserClaims {
            user_id: Some(OWNER_ID.to_string()),
            fusion_user_id: None,
            organization_id: None,
        },
        ActingUserClaims {
            user_id: None,
            fusion_user_id: Some(FUSION_USER_ID.to_string()),
            organization_id: None,
        },
    ];

    for claims in identifier_claims {
        let bot_id = BotId::new_from_uuid(Uuid::new_v4());
        let repo = FakeBotRepo::new(bot_id, Uuid::new_v4());

        let principal = service(repo)
            .authorize_bot_request(RAW_TOKEN, Some(claims))
            .await
            .unwrap();

        assert_eq!(principal.acting_user, Some(acting_user()));
    }
}

#[tokio::test]
async fn rejects_user_who_is_not_the_exact_bot_owner() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.bot = Some(bot(
        bot_id,
        BotKind::Owned,
        Some(user_owner("macro|other@example.com")),
    ));

    assert_forbidden(
        service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await,
    );
    assert!(repo.calls.lock().unwrap().team_lookups.is_empty());
}

#[tokio::test]
async fn authorizes_current_team_member() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.bot = Some(bot(
        bot_id,
        BotKind::Owned,
        Some(BotOwner::Team { team_id }),
    ));

    let principal = service(repo.clone())
        .authorize_bot_request(RAW_TOKEN, Some(claims()))
        .await
        .unwrap();

    assert_eq!(principal.acting_user, Some(acting_user()));
    assert_eq!(
        repo.calls.lock().unwrap().team_lookups,
        [(OWNER_ID.to_string(), team_id)]
    );
}

#[tokio::test]
async fn rejects_user_without_current_team_membership() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.bot = Some(bot(
        bot_id,
        BotKind::Owned,
        Some(BotOwner::Team { team_id }),
    ));
    repo.user_has_team = false;

    assert_forbidden(
        service(repo)
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await,
    );
}

#[tokio::test]
async fn rejects_system_bot_without_user_or_owner_policy_lookups() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.candidate = Some(token_candidate(bot_id, token_id, BotKind::System));
    repo.bot = Some(bot(bot_id, BotKind::System, None));

    assert_forbidden(
        service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await,
    );

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.marked_token_ids, [token_id]);
    assert!(calls.acting_user_claims.is_empty());
    assert!(calls.bot_ids.is_empty());
    assert!(calls.team_lookups.is_empty());
}

#[tokio::test]
async fn rejects_unknown_acting_user_without_owner_policy_lookup() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.acting_user = None;

    assert_forbidden(
        service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await,
    );

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.acting_user_claims, [claims()]);
    assert!(calls.bot_ids.is_empty());
}

#[tokio::test]
async fn rejects_missing_and_malformed_identifiers_without_repository_policy_lookups() {
    let invalid_claims = [
        ActingUserClaims {
            user_id: None,
            fusion_user_id: None,
            organization_id: Some(ORGANIZATION_ID),
        },
        ActingUserClaims {
            user_id: Some("not-a-macro-user-id".to_string()),
            fusion_user_id: None,
            organization_id: None,
        },
    ];

    for claims in invalid_claims {
        let bot_id = BotId::new_from_uuid(Uuid::new_v4());
        let token_id = Uuid::new_v4();
        let repo = FakeBotRepo::new(bot_id, token_id);

        assert_forbidden(
            service(repo.clone())
                .authorize_bot_request(RAW_TOKEN, Some(claims))
                .await,
        );

        let calls = repo.calls.lock().unwrap();
        assert_eq!(calls.marked_token_ids, [token_id]);
        assert!(calls.acting_user_claims.is_empty());
        assert!(calls.bot_ids.is_empty());
    }
}

#[tokio::test]
async fn rejects_dual_identifier_mismatch() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);
    let mut mismatched_claims = claims();
    mismatched_claims.fusion_user_id = Some("different-fusion-user".to_string());

    assert_forbidden(
        service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(mismatched_claims))
            .await,
    );
    assert!(repo.calls.lock().unwrap().bot_ids.is_empty());
}

#[tokio::test]
async fn rejects_organization_mismatch() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);
    let mut mismatched_claims = claims();
    mismatched_claims.organization_id = Some(ORGANIZATION_ID + 1);

    assert_forbidden(
        service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(mismatched_claims))
            .await,
    );
    assert!(repo.calls.lock().unwrap().bot_ids.is_empty());
}

#[tokio::test]
async fn token_failures_short_circuit_all_policy_and_mark_used_lookups() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());

    let token_id = Uuid::new_v4();
    let mut unknown_repo = FakeBotRepo::new(bot_id, token_id);
    unknown_repo.candidate = None;

    let token_id = Uuid::new_v4();
    let mut deleted_bot_repo = FakeBotRepo::new(bot_id, token_id);
    deleted_bot_repo.candidate = None;

    let token_id = Uuid::new_v4();
    let mut revoked_repo = FakeBotRepo::new(bot_id, token_id);
    let mut revoked_candidate = token_candidate(bot_id, token_id, BotKind::Owned);
    revoked_candidate.token.revoked_at = Some(Utc::now());
    revoked_repo.candidate = Some(revoked_candidate);

    let token_id = Uuid::new_v4();
    let mut expired_repo = FakeBotRepo::new(bot_id, token_id);
    let mut expired_candidate = token_candidate(bot_id, token_id, BotKind::Owned);
    expired_candidate.token.expires_at = Some(Utc::now() - Duration::minutes(1));
    expired_repo.candidate = Some(expired_candidate);

    for repo in [unknown_repo, deleted_bot_repo, revoked_repo, expired_repo] {
        let result = service(repo.clone())
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await;
        assert!(matches!(result, Err(BotError::Unauthorized)));

        let calls = repo.calls.lock().unwrap();
        assert!(calls.marked_token_ids.is_empty());
        assert!(calls.acting_user_claims.is_empty());
        assert!(calls.bot_ids.is_empty());
        assert!(calls.team_lookups.is_empty());
    }
}

#[tokio::test]
async fn repository_errors_are_not_collapsed_into_policy_errors() {
    let failures = [
        RepositoryFailure::TokenCandidate,
        RepositoryFailure::MarkTokenUsed,
        RepositoryFailure::FindActingUser,
        RepositoryFailure::GetBot,
    ];

    for failure in failures {
        let bot_id = BotId::new_from_uuid(Uuid::new_v4());
        let token_id = Uuid::new_v4();
        let repo = FakeBotRepo::new(bot_id, token_id).fail_at(failure);
        assert_repo_error(
            service(repo)
                .authorize_bot_request(RAW_TOKEN, Some(claims()))
                .await,
        );
    }

    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id).fail_at(RepositoryFailure::UserHasTeam);
    repo.bot = Some(bot(
        bot_id,
        BotKind::Owned,
        Some(BotOwner::Team { team_id }),
    ));
    assert_repo_error(
        service(repo)
            .authorize_bot_request(RAW_TOKEN, Some(claims()))
            .await,
    );
}

#[tokio::test]
async fn existing_token_authentication_retains_behavior() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);
    let service = service(repo.clone());

    let authenticated = service.authenticate_token(RAW_TOKEN).await.unwrap();
    assert_eq!(authenticated.bot_id, bot_id);
    assert_eq!(authenticated.kind, BotKind::Owned);

    let channel_authenticated = service
        .authenticate_channel_token(channel_id, RAW_TOKEN)
        .await
        .unwrap();
    assert_eq!(channel_authenticated.bot_id, bot_id);
    assert_eq!(channel_authenticated.kind, BotKind::Owned);

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.marked_token_ids, [token_id, token_id]);
    assert_eq!(
        calls.channel_token_candidates,
        [(channel_id, RAW_TOKEN.to_string())]
    );
}

#[tokio::test]
async fn ensures_active_channel_membership() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id);

    service(repo.clone())
        .ensure_bot_in_channel(bot_id, channel_id)
        .await
        .unwrap();

    assert_eq!(
        repo.calls.lock().unwrap().channel_lookups,
        [(channel_id, bot_id)]
    );
}

#[tokio::test]
async fn rejects_inactive_channel_membership_as_unauthorized() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let mut repo = FakeBotRepo::new(bot_id, token_id);
    repo.bot_active_in_channel = false;

    let result = service(repo)
        .ensure_bot_in_channel(bot_id, channel_id)
        .await;

    assert!(matches!(result, Err(BotError::Unauthorized)));
}

#[tokio::test]
async fn preserves_channel_membership_repository_errors() {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let token_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let repo = FakeBotRepo::new(bot_id, token_id).fail_at(RepositoryFailure::BotActiveInChannel);

    assert_repo_error(
        service(repo)
            .ensure_bot_in_channel(bot_id, channel_id)
            .await,
    );
}
