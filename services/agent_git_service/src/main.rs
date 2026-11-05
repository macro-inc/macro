//! Composition root of the agent workspace git service.

use std::sync::Arc;

use agent_git::domain::models::RepoLimits;
use agent_git::domain::service::{AgentGitAdapters, AgentGitServiceImpl};
use agent_git::domain::template::WORKSPACE_TEMPLATE;
use agent_git::inbound::http::{AgentGitRouterState, agent_git_router};
use agent_git::outbound::bare_repo_store::BareRepoStore;
use agent_git::outbound::git_http_backend::GitHttpBackend;
use agent_git::outbound::pg_repo_repository::PgRepoRepository;
use agent_git::outbound::push_rate_limiter::InMemoryPushRateLimiter;
use agent_git::outbound::repo_directories::RepoDirectories;
use agent_git::outbound::team_admins::TeamRepositoryAdmins;
use axum::{Router, http::StatusCode, routing::get};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, PgUserApiKeyAuthorizationRepo,
    PgUserApiKeyAuthorizer,
};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::AgentGitServiceUrl;
use sqlx::postgres::PgPoolOptions;
use tower_http::trace::TraceLayer;

mod config;

const PORT: u16 = 8080;
/// Prefix the shared gateway forwards unchanged.
const GATEWAY_PATH_PREFIX: &str = "/agent-git";
const MAX_DATABASE_CONNECTIONS: u32 = 10;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<config::Config>()?;

    let pool = PgPoolOptions::new()
        .max_connections(MAX_DATABASE_CONNECTIONS)
        .connect(config.database_url.as_ref())
        .await?;

    let secrets_manager = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );
    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secrets_manager).await?;
    let authorization_state =
        MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            MacroAuthJwtValidator::new(jwt_args),
            InternalAuthConfig {
                api_key: config.internal_api_key.to_string(),
                default_user_id: None,
            },
            NoBotAuthorizer,
            PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(pool.clone())),
        )));

    // Fail at startup, not on the first clone, when the volume is missing.
    if !tokio::fs::metadata(&config.repo_storage_root)
        .await?
        .is_dir()
    {
        return Err(rootcause::report!(
            "REPO_STORAGE_ROOT {} is not a directory",
            config.repo_storage_root.display()
        ));
    }
    let directories = RepoDirectories::new(config.repo_storage_root.clone());

    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: PgRepoRepository::new(pool.clone()),
            store: BareRepoStore::new(directories.clone()),
            admins: TeamRepositoryAdmins::new(teams::outbound::team_repo::TeamRepositoryImpl::new(
                pool,
            )),
            limiter: InMemoryPushRateLimiter::new(config.pushes_per_minute),
            backend: GitHttpBackend::new(directories),
        },
        RepoLimits {
            max_repo_size_bytes: config.max_repo_size_bytes,
        },
        WORKSPACE_TEMPLATE,
    );

    let public_base_url = AgentGitServiceUrl::new()?.to_string();
    let routes = agent_git_router(AgentGitRouterState::new(
        Arc::new(service),
        authorization_state,
        public_base_url.trim_end_matches('/').to_owned(),
    ))
    .route("/health", get(|| async { StatusCode::OK }));

    // No compression layer: pack streams are already compressed.
    let app = Router::new()
        .merge(routes.clone())
        .nest(GATEWAY_PATH_PREFIX, routes)
        .layer(macro_cors::cors_layer())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await?;
    tracing::info!(port = PORT, "agent git service listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}
