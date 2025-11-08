use super::config::Config;
use crate::api::{ApiContext, router as api_router, swagger};
use axum::{Router, routing::get};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_cors::cors_layer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub async fn setup_and_serve(config: Config) {
    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));
    tracing::debug!("initialized secretsmanager client");

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await
            .unwrap();

    let port = config.port;
    let api_context = ApiContext::connect_from_config(config, jwt_args)
        .await
        .expect("Failed to setup API context");

    let router = Router::new()
        .route("/health", get(|| async { "healthy" }))
        .nest(
            "/",
            api_router().layer(axum::middleware::from_fn_with_state(
                api_context.clone(),
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http())
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .with_state(api_context);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind to port");

    axum::serve(listener, router)
        .await
        .expect("Failed to start service router")
}
