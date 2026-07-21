use std::sync::{Arc, Mutex};

use macro_authorization::{
    BotActingUserClaims, BotAuthorizer, MacroAuthorizationError, MacroUserAuthentication,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    models::{
        ActingUser, ActingUserClaims, AuthenticatedBot, AuthorizedBotPrincipal, Bot, BotChannel,
        BotId, BotKind, BotToken, CreateBotRequest, CreateBotTokenRequest, CreateBotTokenResponse,
        CreateChannelScopedBotRequest, CreateChannelScopedBotResponse, PatchBotRequest,
    },
    ports::{BotError, BotService},
};

use super::BotServiceAuthorizer;

const RAW_TOKEN: &str = "mbot_adapter_secret_material";
const BOT_ID: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
const TOKEN_ID: Uuid = Uuid::from_u128(2);
const ACTING_USER_ID: &str = "macro|acting@example.com";
const FUSION_USER_ID: &str = "fusion-acting-user";
const ORGANIZATION_ID: i32 = 42;

#[derive(Clone, Debug, PartialEq, Eq)]
struct AuthorizationCall {
    token: String,
    claims: Option<ActingUserClaims>,
}

#[derive(Clone)]
enum AuthorizationOutcome {
    Success(AuthorizedBotPrincipal),
    Unauthorized,
    ForbiddenActingUser,
    RepositoryFailure,
    BadRequest,
    NotFound,
}

#[derive(Clone)]
struct FakeBotService {
    outcome: AuthorizationOutcome,
    calls: Arc<Mutex<Vec<AuthorizationCall>>>,
}

impl FakeBotService {
    fn new(outcome: AuthorizationOutcome) -> Self {
        Self {
            outcome,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<AuthorizationCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl BotService for FakeBotService {
    async fn create_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _req: CreateBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn create_channel_scoped_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: CreateChannelScopedBotRequest,
    ) -> Result<CreateChannelScopedBotResponse, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn list_bots(&self, _caller: MacroUserIdStr<'static>) -> Result<Vec<Bot>, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn get_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Bot, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn patch_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: PatchBotRequest,
    ) -> Result<Bot, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn delete_bot(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn add_bot_to_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn remove_bot_from_channel(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _bot_id: BotId,
    ) -> Result<(), BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn list_bot_channels(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotChannel>, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn list_channel_bots(&self, _channel_id: Uuid) -> Result<Vec<Bot>, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn create_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _req: CreateBotTokenRequest,
    ) -> Result<CreateBotTokenResponse, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn list_tokens(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> Result<Vec<BotToken>, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn revoke_token(
        &self,
        _caller: MacroUserIdStr<'static>,
        _bot_id: BotId,
        _token_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn authorize_bot_request(
        &self,
        token: &str,
        claims: Option<ActingUserClaims>,
    ) -> Result<AuthorizedBotPrincipal, BotError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall {
                token: token.to_owned(),
                claims,
            });

        match &self.outcome {
            AuthorizationOutcome::Success(principal) => Ok(principal.clone()),
            AuthorizationOutcome::Unauthorized => Err(BotError::Unauthorized),
            AuthorizationOutcome::ForbiddenActingUser => Err(BotError::ForbiddenActingUser),
            AuthorizationOutcome::RepositoryFailure => {
                Err(BotError::Repo(anyhow::anyhow!("repository unavailable")))
            }
            AuthorizationOutcome::BadRequest => {
                Err(BotError::BadRequest("unexpected bad request".to_owned()))
            }
            AuthorizationOutcome::NotFound => {
                Err(BotError::NotFound("unexpected not found".to_owned()))
            }
        }
    }

    async fn ensure_bot_in_channel(
        &self,
        _bot_id: BotId,
        _channel_id: Uuid,
    ) -> Result<(), BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn authenticate_token(&self, _token: &str) -> Result<AuthenticatedBot, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }

    async fn authenticate_channel_token(
        &self,
        _channel_id: Uuid,
        _token: &str,
    ) -> Result<AuthenticatedBot, BotError> {
        unimplemented!("not used by authorization adapter tests")
    }
}

fn bare_principal() -> AuthorizedBotPrincipal {
    AuthorizedBotPrincipal {
        bot: AuthenticatedBot {
            bot_id: BOT_ID,
            kind: BotKind::Owned,
        },
        token_id: TOKEN_ID,
        acting_user: None,
    }
}

fn acting_user() -> ActingUser {
    ActingUser {
        macro_user_id: MacroUserIdStr::try_from(ACTING_USER_ID.to_owned())
            .expect("valid Macro user id"),
        fusion_user_id: FUSION_USER_ID.to_owned(),
        organization_id: Some(ORGANIZATION_ID),
    }
}

fn acting_principal() -> AuthorizedBotPrincipal {
    AuthorizedBotPrincipal {
        acting_user: Some(acting_user()),
        ..bare_principal()
    }
}

fn assert_acting_user(authentication: MacroUserAuthentication) {
    assert_eq!(authentication.macro_user_id.as_ref(), ACTING_USER_ID);
    assert_eq!(authentication.user_context.user_id, ACTING_USER_ID);
    assert_eq!(authentication.user_context.fusion_user_id, FUSION_USER_ID);
    assert_eq!(
        authentication.user_context.organization_id,
        Some(ORGANIZATION_ID)
    );
    assert_eq!(authentication.user_context.permissions, None);
}

#[tokio::test]
async fn authorizes_a_bare_bot_principal() {
    let service = FakeBotService::new(AuthorizationOutcome::Success(bare_principal()));
    let authorizer = BotServiceAuthorizer::new(service.clone());

    let authentication = authorizer
        .authorize_bot(RAW_TOKEN, None)
        .await
        .expect("bare bot should be authorized");

    assert_eq!(authentication.bot_id, BOT_ID);
    assert_eq!(authentication.token_id, TOKEN_ID);
    assert!(authentication.acting_user.is_none());
    assert_eq!(
        service.calls(),
        vec![AuthorizationCall {
            token: RAW_TOKEN.to_owned(),
            claims: None,
        }]
    );
}

#[tokio::test]
async fn forwards_exact_acting_user_claims_and_maps_the_verified_user() {
    let service = FakeBotService::new(AuthorizationOutcome::Success(acting_principal()));
    let authorizer = BotServiceAuthorizer::new(service.clone());
    let claims = BotActingUserClaims {
        user_id: Some(ACTING_USER_ID.to_owned()),
        fusion_user_id: Some(FUSION_USER_ID.to_owned()),
        organization_id: Some(ORGANIZATION_ID),
    };

    let authentication = authorizer
        .authorize_bot(RAW_TOKEN, Some(claims))
        .await
        .expect("acting bot should be authorized");

    assert_eq!(authentication.bot_id, BOT_ID);
    assert_eq!(authentication.token_id, TOKEN_ID);
    assert_acting_user(
        authentication
            .acting_user
            .expect("verified acting user should be returned"),
    );
    assert_eq!(
        service.calls(),
        vec![AuthorizationCall {
            token: RAW_TOKEN.to_owned(),
            claims: Some(ActingUserClaims {
                user_id: Some(ACTING_USER_ID.to_owned()),
                fusion_user_id: Some(FUSION_USER_ID.to_owned()),
                organization_id: Some(ORGANIZATION_ID),
            }),
        }]
    );
}

#[tokio::test]
async fn maps_every_bot_service_error_without_leaking_domain_details() {
    let cases = [
        (
            AuthorizationOutcome::Unauthorized,
            MacroAuthorizationError::InvalidCredentials,
        ),
        (
            AuthorizationOutcome::ForbiddenActingUser,
            MacroAuthorizationError::ActingUserNotAuthorized,
        ),
        (
            AuthorizationOutcome::RepositoryFailure,
            MacroAuthorizationError::Unavailable,
        ),
        (
            AuthorizationOutcome::BadRequest,
            MacroAuthorizationError::Unavailable,
        ),
        (
            AuthorizationOutcome::NotFound,
            MacroAuthorizationError::Unavailable,
        ),
    ];

    for (outcome, expected) in cases {
        let error = BotServiceAuthorizer::new(FakeBotService::new(outcome))
            .authorize_bot(RAW_TOKEN, None)
            .await
            .expect_err("bot authorization should fail");

        assert_eq!(error.current_context(), &expected);
    }
}

#[tokio::test]
async fn raw_token_is_absent_from_returned_authorization_material() {
    let authentication = BotServiceAuthorizer::new(FakeBotService::new(
        AuthorizationOutcome::Success(acting_principal()),
    ))
    .authorize_bot(RAW_TOKEN, None)
    .await
    .expect("bot should be authorized");
    assert!(!format!("{authentication:?}").contains(RAW_TOKEN));

    let error = BotServiceAuthorizer::new(FakeBotService::new(AuthorizationOutcome::Unauthorized))
        .authorize_bot(RAW_TOKEN, None)
        .await
        .expect_err("bot authorization should fail");
    assert!(!format!("{error:?}").contains(RAW_TOKEN));
}

#[test]
fn authorizer_clones_share_the_backing_service() {
    let service = FakeBotService::new(AuthorizationOutcome::Success(bare_principal()));
    let authorizer = BotServiceAuthorizer::new(service);
    let cloned = authorizer.clone();

    assert_eq!(Arc::strong_count(&authorizer.0), 2);
    drop(cloned);
    assert_eq!(Arc::strong_count(&authorizer.0), 1);
}
