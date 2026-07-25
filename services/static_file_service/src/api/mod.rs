pub mod context;
mod event;
pub mod file;
mod health;
pub(crate) mod swagger;

use super::config::Config;
use super::service::dynamodb::client::DynamodbClient;
use super::service::s3::client::S3Client;
use crate::api::context::{AppState, AuthorizationService};
use anyhow::Context;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

static MAX_REQUEST_SIZE: usize = 4096;

/// Identity assumed for internal service callers that don't forward an acting user.
pub const MACRO_INTERNAL_USER_ID: &str = "macro|INTERNAL@macro.com";

pub async fn setup_and_serve(
    config: Config,
    jwt_validation_args: JwtValidationArgs,
) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let metadata_client = DynamodbClient::new(
        &aws_config,
        config
            .static_file_service_dynamodb_table_name
            .as_ref()
            .to_owned(),
    );

    let sqs_client = aws_sdk_sqs::Client::new(&aws_config);
    let inner_client = macro_aws_config::s3_client().await;
    let storage_client = S3Client::new(
        inner_client,
        config.static_storage_bucket.as_ref().to_owned(),
    );

    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(jwt_validation_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.as_ref().to_string(),
            default_user_id: Some(MACRO_INTERNAL_USER_ID.to_string()),
        },
        macro_authorization::NoBotAuthorizer,
    )));

    let state = AppState {
        metadata_client,
        storage_client: Arc::new(storage_client),
        sqs_client,
        config: Arc::new(config),
        authorization_state,
    };

    let state_clone = state.clone();
    if !cfg!(feature = "local_auth") {
        tokio::spawn(async move { event::poll::poll_s3_events(state_clone).await });
    }

    let port = state.config.port;
    let environment = state.config.environment;
    // Authentication is enforced per-handler by `MacroAuthorizationExtractor`,
    // which accepts user credentials (JWT) as well as the internal service key.
    let app = Router::new()
        .nest(
            "/api", // needed for cdn routing
            Router::new().merge(file::router()).merge(health::router()),
        )
        .nest(
            "/internal",
            // Same file router; internal callers authenticate with the internal
            // service key headers instead of a jwt
            file::router(),
        )
        .with_state(state)
        .merge(
            SwaggerUi::new("/api/docs")
                .url("/api/api-doc/openapi.json", swagger::ApiDoc::openapi()),
        )
        .layer(cors.clone())
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_SIZE)); // 1GB

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    tracing::info!(
        "\n💀 static_file_service 💀\nenvironment: {:?}\nport: {}",
        environment,
        port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}
