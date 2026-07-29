use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use uuid::Uuid;

use super::MacroAuthorizationServiceImpl;
use crate::domain::{
    models::{
        BotActingUserClaims, BotAuthentication, BotScope, InternalAuthConfig,
        InternalIdentityClaims, MacroAuthorizationError, MacroUserAuthentication,
        ValidatedIdentity,
    },
    ports::{BotAuthorizer, JwtValidator, MacroAuthorizationService, NoBotAuthorizer},
};

#[derive(Clone)]
struct FakeJwtValidator {
    result: Result<ValidatedIdentity, MacroAuthorizationError>,
}

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, _jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        self.result.clone().map_err(Report::new)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BotAuthorizationCall {
    bot_token: String,
    bot_scope: BotScope,
    acting_user: Option<BotActingUserClaims>,
}

#[derive(Clone)]
struct FakeBotAuthorizer {
    calls: Arc<Mutex<Vec<BotAuthorizationCall>>>,
    result: Result<BotAuthentication, MacroAuthorizationError>,
}

impl FakeBotAuthorizer {
    fn new(result: Result<BotAuthentication, MacroAuthorizationError>) -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            result,
        }
    }

    fn calls(&self) -> Vec<BotAuthorizationCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl BotAuthorizer for FakeBotAuthorizer {
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(BotAuthorizationCall {
                bot_token: bot_token.to_string(),
                bot_scope,
                acting_user,
            });

        self.result.clone().map_err(Report::new)
    }
}

#[derive(Clone)]
struct DefaultRejectingAuthorizationService;

impl MacroAuthorizationService for DefaultRejectingAuthorizationService {
    async fn authorize(&self, _jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

const INTERNAL_API_KEY: &str = "secret-key";
const BOT_ID: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
const TOKEN_ID: Uuid = Uuid::from_u128(2);
const TEAM_ID: Uuid = Uuid::from_u128(3);

fn internal_auth_config(default_user_id: Option<&str>) -> InternalAuthConfig {
    InternalAuthConfig {
        api_key: INTERNAL_API_KEY.to_string(),
        default_user_id: default_user_id.map(str::to_string),
    }
}

fn service_with_internal_auth(
    default_user_id: Option<&str>,
) -> MacroAuthorizationServiceImpl<FakeJwtValidator> {
    MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::InvalidCredentials),
        },
        internal_auth_config(default_user_id),
        NoBotAuthorizer,
    )
}

fn bot_authentication() -> BotAuthentication {
    BotAuthentication {
        bot_id: BOT_ID,
        token_id: TOKEN_ID,
        bot_scope: BotScope::Team,
        team_id: Some(TEAM_ID),
        acting_user: Some(MacroUserAuthentication {
            macro_user_id: MacroUserIdStr::try_from("macro|acting@example.com".to_string())
                .expect("valid Macro user id"),
            user_context: UserContext {
                user_id: "macro|acting@example.com".to_string(),
                fusion_user_id: "fusion-acting-user".to_string(),
                permissions: None,
                organization_id: Some(42),
            },
        }),
    }
}

fn assert_bot_authentication(bot: &BotAuthentication) {
    assert_eq!(bot.bot_id, BOT_ID);
    assert_eq!(bot.token_id, TOKEN_ID);
    assert_eq!(bot.bot_scope, BotScope::Team);
    assert_eq!(bot.team_id, Some(TEAM_ID));

    let acting_user = bot
        .acting_user
        .as_ref()
        .expect("expected a verified acting user");
    assert_eq!(
        acting_user.macro_user_id.as_ref(),
        "macro|acting@example.com"
    );
    assert_eq!(acting_user.user_context.user_id, "macro|acting@example.com");
    assert_eq!(
        acting_user.user_context.fusion_user_id,
        "fusion-acting-user"
    );
    assert_eq!(acting_user.user_context.organization_id, Some(42));
    assert_eq!(acting_user.user_context.permissions, None);
}

#[tokio::test]
async fn no_bot_authorizer_rejects_bot_credentials() {
    let error = NoBotAuthorizer
        .authorize_bot(
            "bot-token",
            BotScope::User,
            Some(BotActingUserClaims {
                user_id: Some("macro|acting@example.com".to_string()),
                fusion_user_id: None,
                organization_id: None,
            }),
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn authorization_service_trait_rejects_bots_by_default() {
    let error = DefaultRejectingAuthorizationService
        .authorize_bot("bot-token", BotScope::User, None)
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn authorization_service_impl_rejects_bots_with_explicit_no_bot_authorizer() {
    let error = service_with_internal_auth(None)
        .authorize_bot("bot-token", BotScope::User, None)
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn authorize_bot_delegates_token_and_exact_acting_user_claims() {
    let claims = BotActingUserClaims {
        user_id: Some("macro|acting@example.com".to_string()),
        fusion_user_id: Some("fusion-acting-user".to_string()),
        organization_id: Some(42),
    };
    let authorizer = FakeBotAuthorizer::new(Ok(bot_authentication()));
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::InvalidCredentials),
        },
        internal_auth_config(None),
        authorizer.clone(),
    );

    let bot = service
        .authorize_bot("bot-token", BotScope::Team, Some(claims.clone()))
        .await
        .unwrap();

    assert_bot_authentication(&bot);
    assert_eq!(
        authorizer.calls(),
        vec![BotAuthorizationCall {
            bot_token: "bot-token".to_string(),
            bot_scope: BotScope::Team,
            acting_user: Some(claims),
        }]
    );
}

#[tokio::test]
async fn authorize_bot_passes_through_authorizer_errors() {
    for expected in [
        MacroAuthorizationError::InvalidCredentials,
        MacroAuthorizationError::ActingUserNotAuthorized,
        MacroAuthorizationError::BotScopeNotAuthorized,
        MacroAuthorizationError::Unavailable,
    ] {
        let service = MacroAuthorizationServiceImpl::new(
            FakeJwtValidator {
                result: Err(MacroAuthorizationError::InvalidCredentials),
            },
            internal_auth_config(None),
            FakeBotAuthorizer::new(Err(expected)),
        );

        let error = service
            .authorize_bot("bot-token", BotScope::User, None)
            .await
            .unwrap_err();

        assert_eq!(error.current_context(), &expected);
    }
}

#[tokio::test]
async fn authorize_constructs_user_context_from_validated_identity() {
    let permissions = HashSet::from(["documents:read".to_string(), "documents:write".to_string()]);
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Ok(ValidatedIdentity {
                user_id: "macro|user@example.com".to_string(),
                fusion_user_id: "fusion-user-id".to_string(),
                organization_id: Some(42),
                permissions: Some(permissions.clone()),
            }),
        },
        internal_auth_config(None),
        NoBotAuthorizer,
    );

    let context = service.authorize("valid-jwt").await.unwrap();

    assert_eq!(context.user_id, "macro|user@example.com");
    assert_eq!(context.fusion_user_id, "fusion-user-id");
    assert_eq!(context.organization_id, Some(42));
    assert_eq!(context.permissions, Some(permissions));
}

#[tokio::test]
async fn authorize_internal_rejects_an_incorrect_key() {
    let service = service_with_internal_auth(None);

    let error = service
        .authorize_internal("secret-kex", InternalIdentityClaims::default())
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn authorize_internal_maps_explicit_identity_claims() {
    let service = service_with_internal_auth(Some("macro|default@example.com"));

    let context = service
        .authorize_internal(
            INTERNAL_API_KEY,
            InternalIdentityClaims {
                user_id: Some("macro|acting@example.com".to_string()),
                fusion_user_id: Some("fusion-user-id".to_string()),
                organization_id: Some(42),
            },
        )
        .await
        .unwrap()
        .expect("explicit user claim should establish an identity");

    assert_eq!(context.user_id, "macro|acting@example.com");
    assert_eq!(context.fusion_user_id, "fusion-user-id");
    assert_eq!(context.organization_id, Some(42));
    assert_eq!(context.permissions, None);
}

#[tokio::test]
async fn authorize_internal_uses_the_configured_default_user() {
    let service = service_with_internal_auth(Some("macro|default@example.com"));

    let context = service
        .authorize_internal(INTERNAL_API_KEY, InternalIdentityClaims::default())
        .await
        .unwrap()
        .expect("configured default user should establish an identity");

    assert_eq!(context.user_id, "macro|default@example.com");
    assert_eq!(context.fusion_user_id, "");
    assert_eq!(context.organization_id, None);
    assert_eq!(context.permissions, None);
}

#[tokio::test]
async fn authorize_internal_returns_none_without_an_identity() {
    let service = service_with_internal_auth(None);

    let context = service
        .authorize_internal(INTERNAL_API_KEY, InternalIdentityClaims::default())
        .await
        .unwrap();

    assert!(context.is_none());
}

#[tokio::test]
async fn authorize_propagates_expired_credentials() {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::CredentialsExpired),
        },
        internal_auth_config(None),
        NoBotAuthorizer,
    );

    let error = service.authorize("expired-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::CredentialsExpired
    );
}

#[tokio::test]
async fn authorize_propagates_invalid_credentials() {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator {
            result: Err(MacroAuthorizationError::InvalidCredentials),
        },
        internal_auth_config(None),
        NoBotAuthorizer,
    );

    let error = service.authorize("invalid-jwt").await.unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}
