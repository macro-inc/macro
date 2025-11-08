pub mod context;
mod event;
pub mod file;
mod health;
mod swagger;

use super::config::Config;
use super::service::dynamodb::client::DynamodbClient;
use super::service::s3::client::S3Client;
use crate::api::context::AppState;
use anyhow::Context;
use aws_config::Region;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::{InternalApiSecretKey, ValidInternalKey};
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::limit::RequestBodyLimitLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

static MAX_REQUEST_SIZE: usize = 4096;

pub async fn setup_and_serve(
    config: Config,
    jwt_validation_args: JwtValidationArgs,
    internal_api_secret: LocalOrRemoteSecret<InternalApiSecretKey>,
) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let metadata_client = DynamodbClient::new(
        Region::from_static("us-east-1"),
        config.dynamodb_table.clone(),
    )
    .await;

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;
    let sqs_client = aws_sdk_sqs::Client::new(&aws_config);
    let inner_client = aws_sdk_s3::Client::new(&aws_config);
    let storage_client = S3Client::new(inner_client, config.storage_bucket_name.clone());

    let state = AppState {
        metadata_client,
        storage_client: Arc::new(storage_client),
        sqs_client,
        config: Arc::new(config),
        internal_api_secret,
    };

    let state_clone = state.clone();
    if !cfg!(feature = "local_auth") {
        tokio::spawn(async move { event::poll::poll_s3_events(state_clone).await });
    }

    let port = state.config.port;
    let environment = state.config.environment;
    let app = Router::new()
        .nest(
            "/api", // needed for cdn routing
            Router::new()
                .merge(
                    file::router().layer(
                        ServiceBuilder::new()
                            .layer(axum::middleware::from_fn_with_state(
                                jwt_validation_args.clone(),
                                macro_middleware::auth::decode_jwt::handler,
                            ))
                            .layer(cors.clone()),
                    ),
                )
                .merge(health::router().layer(cors.clone())),
        )
        .nest(
            "/internal",
            // Create a copy of the file router, but use internal auth middleware
            // instead of jwt auth
            file::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_extractor_with_state::<
                        ValidInternalKey,
                        _,
                    >(state.clone()))
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::initialize_user_context::handler,
                    )),
            ),
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
