use super::*;
use crate::config::{Environment, StaticFileServiceDynamodbTableName, StaticStorageBucket};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use macro_auth::{
    InternalApiKey,
    macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token},
};
use tower::ServiceExt;

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

/// The real router over clients that are never called: every request below
/// is answered before a handler would reach AWS.
fn service() -> Router {
    use aws_sdk_s3::config::{BehaviorVersion, Region};
    let jwt = JwtValidationArgs::testing_macro_token("fixture", PUBLIC);
    let aws = macro_aws_config::SdkConfig::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .build();
    let config = Config {
        environment: Environment::Local,
        port: 0,
        static_file_service_dynamodb_table_name: StaticFileServiceDynamodbTableName::new_testing(
            "files",
        ),
        static_storage_bucket: StaticStorageBucket::new_testing("bucket"),
        internal_api_key: InternalApiKey::Comptime("internal"),
    };
    let state = AppState {
        metadata_client: DynamodbClient::new(&aws, "files".to_owned()),
        storage_client: Arc::new(S3Client::new(
            aws_sdk_s3::Client::new(&aws),
            "bucket".to_owned(),
        )),
        sqs_client: aws_sdk_sqs::Client::new(&aws),
        config: Arc::new(config),
        public_url: Arc::new(StaticFilePublicUrl::local()),
        authorization_state: MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
            MacroAuthJwtValidator::new(jwt.clone()),
            InternalAuthConfig {
                api_key: "internal".to_owned(),
                default_user_id: Some(MACRO_INTERNAL_USER_ID.to_owned()),
            },
            macro_authorization::NoBotAuthorizer,
            macro_authorization::NoUserApiKeyAuthorizer,
        ))),
    };
    app(state, jwt)
}

fn credential(scope: Option<&str>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: Some(uuid::Uuid::from_u128(3)),
        agent_via: None,
        agent_correlation_id: Some(uuid::Uuid::from_u128(1)),
        agent_session_id: None,
        routine_id: None,
        agent_scope: scope.map(str::to_owned),
    })
    .unwrap()
}

async fn status(method: &str, path: &str, bearer: Option<String>) -> StatusCode {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(bearer) = bearer {
        request = request.header("authorization", format!("Bearer {bearer}"));
    }
    service()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

/// A generation session's credential changes no files, on either mount,
/// while reads and other callers reach the routes as before.
#[tokio::test]
async fn a_scoped_credential_is_refused_outside_its_scope() {
    for prefix in ["/api", "/internal"] {
        for (method, path) in [
            ("DELETE", "/file/01a1"),
            ("PUT", "/file"),
            ("POST", "/file/bulk-delete"),
        ] {
            let path = format!("{prefix}{path}");
            for scope in ["generation", "newer"] {
                assert_eq!(
                    status(method, &path, Some(credential(Some(scope)))).await,
                    StatusCode::FORBIDDEN,
                    "{scope} {method} {path}"
                );
            }
            // Without a scope the route's own authentication answers.
            assert_ne!(
                status(method, &path, None).await,
                StatusCode::FORBIDDEN,
                "{method} {path}"
            );
        }
    }
    assert_eq!(
        status("GET", "/api/health", Some(credential(Some("generation")))).await,
        StatusCode::OK
    );
}
